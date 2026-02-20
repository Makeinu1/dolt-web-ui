import { useCallback, useEffect, useRef, useState } from "react";
import { useContextStore } from "./store/context";
import { useDraftStore } from "./store/draft";
import { useUIStore, type BaseState } from "./store/ui";
import { ContextSelector } from "./components/ContextSelector/ContextSelector";
import { TableGrid } from "./components/TableGrid/TableGrid";
import { CommitDialog } from "./components/common/CommitDialog";
import { ConflictView } from "./components/ConflictView/ConflictView";
import { SubmitDialog, ApproverInbox } from "./components/RequestDialog/RequestDialog";
import { HistoryTab } from "./components/HistoryTab/HistoryTab";
import { CLIRunbook } from "./components/CLIRunbook/CLIRunbook";
import * as api from "./api/client";
import type { Table } from "./types/api";
import "./App.css";

function stateLabel(state: BaseState): { text: string; className: string } {
  switch (state) {
    case "Idle":
      return { text: "Ready", className: "state-idle" };
    case "DraftEditing":
      return { text: "Draft", className: "state-draft" };
    case "Previewing":
      return { text: "Previewing", className: "state-draft" };
    case "Committing":
      return { text: "Committing...", className: "state-draft" };
    case "Syncing":
      return { text: "Syncing...", className: "state-draft" };
    case "MergeConflictsPresent":
      return { text: "Conflicts", className: "state-conflict" };
    case "SchemaConflictDetected":
      return { text: "Schema Conflict", className: "state-conflict" };
    case "ConstraintViolationDetected":
      return { text: "Constraint Violation", className: "state-conflict" };
    case "StaleHeadDetected":
      return { text: "Stale", className: "state-conflict" };
  }
}

function App() {
  const { targetId, dbName, branchName, branchRefreshKey } = useContextStore();
  const { ops, loadDraft, hasDraft } = useDraftStore();
  const { baseState, requestPending, error, setBaseState, setRequestPending, setError } = useUIStore();

  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [expectedHead, setExpectedHead] = useState("");
  const [showCommit, setShowCommit] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [showApprover, setShowApprover] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const isMain = branchName === "main";
  const isContextReady = targetId !== "" && dbName !== "" && branchName !== "";

  // Prevent body scroll when modal is open
  const anyModalOpen = showCommit || showSubmit || showApprover || showHistory;
  useEffect(() => {
    if (anyModalOpen) {
      document.body.classList.add("modal-open");
    } else {
      document.body.classList.remove("modal-open");
    }
    return () => document.body.classList.remove("modal-open");
  }, [anyModalOpen]);

  // Load draft from sessionStorage
  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  // Load tables when context changes
  useEffect(() => {
    if (!isContextReady) {
      setTables([]);
      setSelectedTable("");
      return;
    }
    api
      .getTables(targetId, dbName, branchName)
      .then((t) => {
        setTables(t);
        if (t.length > 0 && !selectedTable) {
          setSelectedTable(t[0].name);
        }
      })
      .catch((err) => {
        const e = err as { error?: { message?: string } };
        setError(e?.error?.message || "Failed to load tables");
      });
  }, [targetId, dbName, branchName, isContextReady]);

  // Track current branchName to guard against stale async responses
  const branchRef = useRef(branchName);
  useEffect(() => {
    branchRef.current = branchName;
  }, [branchName]);

  // Load HEAD hash (with race condition guard)
  const refreshHead = useCallback(() => {
    if (!isContextReady) return;
    const requestBranch = branchName;
    api
      .getHead(targetId, dbName, branchName)
      .then((h) => {
        if (branchRef.current === requestBranch) {
          setExpectedHead(h.hash);
        }
      })
      .catch((err) => {
        const e = err as { error?: { message?: string } };
        if (branchRef.current === requestBranch) {
          setError(e?.error?.message || "Failed to get HEAD");
        }
      });
  }, [targetId, dbName, branchName, isContextReady]);

  useEffect(() => {
    refreshHead();
  }, [refreshHead]);

  // Refresh data when branchRefreshKey changes (e.g. after approve/reject)
  useEffect(() => {
    if (branchRefreshKey > 0) {
      refreshHead();
      setRefreshKey((k) => k + 1);
    }
  }, [branchRefreshKey]);

  // Update base state based on draft
  useEffect(() => {
    if (hasDraft() && baseState === "Idle") {
      setBaseState("DraftEditing");
    }
  }, [ops, baseState, hasDraft, setBaseState]);

  const handleSync = async () => {
    if (hasDraft()) {
      setError("ドラフトを破棄してから同期してください。");
      return;
    }
    setBaseState("Syncing");
    try {
      const result = await api.sync({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        expected_head: expectedHead,
      });
      setExpectedHead(result.hash);
      setBaseState("Idle");
    } catch (err: unknown) {
      const e = err as { error?: { code?: string; message?: string } };
      const code = e?.error?.code;
      if (code === "MERGE_CONFLICTS_PRESENT") {
        setBaseState("MergeConflictsPresent");
      } else if (code === "SCHEMA_CONFLICTS_PRESENT") {
        setBaseState("SchemaConflictDetected");
      } else if (code === "CONSTRAINT_VIOLATIONS_PRESENT") {
        setBaseState("ConstraintViolationDetected");
      } else if (code === "STALE_HEAD") {
        setBaseState("StaleHeadDetected");
      } else {
        setBaseState("Idle");
      }
      setError(e?.error?.message || "Sync failed");
    }
  };

  const handleRefresh = () => {
    refreshHead();
    setRefreshKey((k) => k + 1);
    if (baseState === "StaleHeadDetected") {
      setBaseState(hasDraft() ? "DraftEditing" : "Idle");
      setError(null);
    }
  };

  const onCommitSuccess = (newHash: string) => {
    setExpectedHead(newHash);
    setRefreshKey((k) => k + 1);
  };

  const onConflictResolved = (newHash: string) => {
    setExpectedHead(newHash);
    setBaseState("Idle");
  };

  // Close overflow menu on outside click
  const overflowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showOverflow) return;
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showOverflow]);

  const label = stateLabel(baseState);

  // Count tables with pending changes
  const tablesWithChanges = new Set(ops.map((op) => op.table));

  // State-driven action button
  const actionButton = () => {
    if (isMain) return null;
    if (baseState === "StaleHeadDetected") {
      return (
        <button className="action-btn action-refresh" onClick={handleRefresh}>
          ↻ Refresh
        </button>
      );
    }
    if (hasDraft()) {
      return (
        <button
          className="action-btn action-commit"
          onClick={() => setShowCommit(true)}
          disabled={
            baseState === "Committing" ||
            baseState === "Syncing" ||
            baseState === "MergeConflictsPresent" ||
            baseState === "SchemaConflictDetected" ||
            baseState === "ConstraintViolationDetected"
          }
        >
          Commit ({ops.length})
        </button>
      );
    }
    return null;
  };

  // Build overflow menu items
  const overflowItems = () => {
    const items: { label: string; onClick: () => void; disabled?: boolean; disabledReason?: string; danger?: boolean }[] = [];

    if (!isMain) {
      // Sync
      const syncDisabled = hasDraft() || baseState === "Syncing" || baseState === "Committing" ||
        baseState === "MergeConflictsPresent" || baseState === "SchemaConflictDetected" ||
        baseState === "ConstraintViolationDetected";
      items.push({
        label: "↻ Sync with Main",
        onClick: () => { handleSync(); setShowOverflow(false); },
        disabled: syncDisabled,
        disabledReason: syncDisabled
          ? (hasDraft() ? "ドラフトがあると同期できません" : "処理中は同期できません")
          : undefined,
      });

      // Submit
      const submitDisabled = hasDraft() || baseState !== "Idle";
      items.push({
        label: "📤 Submit for Approval",
        onClick: () => { setShowSubmit(true); setShowOverflow(false); },
        disabled: submitDisabled,
        disabledReason: submitDisabled
          ? (hasDraft() ? "先にコミットしてください" : "Idle状態でないとSubmitできません")
          : undefined,
      });

      // Refresh
      items.push({
        label: "🔄 Refresh",
        onClick: () => { handleRefresh(); setShowOverflow(false); },
      });
    }

    // Compare Versions (History)
    items.push({
      label: "📊 Compare Versions...",
      onClick: () => { setShowHistory(true); setShowOverflow(false); },
    });

    return items;
  };

  return (
    <div className="app-layout">
      {/* === Single-line Header (36px) === */}
      <header className="unified-header">
        <div className="header-left">
          <span className={`state-badge ${label.className}`}>{label.text}</span>
          <ContextSelector />
          {/* Table selector */}
          {isContextReady && tables.length > 0 && (
            <select
              className="header-table-select"
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
            >
              {tables.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} {tablesWithChanges.has(t.name) ? "●" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="header-right">
          {/* State-driven action button */}
          {actionButton()}

          {/* Approver badge */}
          {requestPending && (
            <button
              className="approver-badge"
              onClick={() => setShowApprover(true)}
              title="承認待ちリクエストを表示"
            >
              📋
            </button>
          )}

          {/* Overflow menu */}
          {isContextReady && (
            <div className="overflow-wrapper" ref={overflowRef}>
              <button
                className="overflow-btn"
                onClick={() => setShowOverflow(!showOverflow)}
              >
                ⋮
              </button>
              {showOverflow && (
                <div className="overflow-menu">
                  {overflowItems().map((item, i) => (
                    <button
                      key={i}
                      className={`overflow-item ${item.danger ? "danger" : ""}`}
                      onClick={item.onClick}
                      disabled={item.disabled}
                      title={item.disabledReason}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {!isContextReady ? (
        <div className="empty-state">
          Select a target, database, and branch to get started.
        </div>
      ) : (
        <div className="work-content">
          {/* Conflict alert banner */}
          {baseState === "MergeConflictsPresent" && (
            <div className="conflict-banner">
              <strong>⚠ Merge Conflicts Detected</strong>
              <p>コンフリクトを解決してください。</p>
            </div>
          )}

          {/* Grid fills all remaining space */}
          <div className="grid-container">
            {selectedTable && <TableGrid tableName={selectedTable} refreshKey={refreshKey} />}
          </div>

          {/* ConflictView overlay */}
          {baseState === "MergeConflictsPresent" && (
            <div className="conflict-overlay">
              <ConflictView
                expectedHead={expectedHead}
                onResolved={onConflictResolved}
              />
            </div>
          )}
        </div>
      )}

      {/* === Modals === */}
      {showCommit && (
        <CommitDialog
          expectedHead={expectedHead}
          onClose={() => setShowCommit(false)}
          onCommitSuccess={onCommitSuccess}
        />
      )}
      {showSubmit && (
        <SubmitDialog
          expectedHead={expectedHead}
          onClose={() => setShowSubmit(false)}
          onSubmitted={() => setRequestPending(true)}
        />
      )}
      {showApprover && (
        <div className="modal-overlay" onClick={() => setShowApprover(false)}>
          <div className="modal" style={{ minWidth: 700, maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>承認待ちリクエスト</h2>
              <button onClick={() => setShowApprover(false)} style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>
            <ApproverInbox />
          </div>
        </div>
      )}
      {showHistory && (
        <div className="modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="modal" style={{ minWidth: 700, maxWidth: 900, maxHeight: "80vh" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Compare Versions</h2>
              <button onClick={() => setShowHistory(false)} style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>
            <HistoryTab />
          </div>
        </div>
      )}
      {/* CLI intervention screen for fatal states */}
      <CLIRunbook />
    </div>
  );
}

export default App;
