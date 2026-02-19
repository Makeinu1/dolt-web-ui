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

type TopTab = "work" | "history" | "requests";

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
      return { text: "Schema Conflict (CLI)", className: "state-conflict" };
    case "ConstraintViolationDetected":
      return { text: "Constraint Violation (CLI)", className: "state-conflict" };
    case "StaleHeadDetected":
      return { text: "Stale HEAD", className: "state-conflict" };
  }
}

function App() {
  const { targetId, dbName, branchName, branchRefreshKey } = useContextStore();
  const { ops, loadDraft, hasDraft } = useDraftStore();
  const { baseState, requestPending, error, setBaseState, setRequestPending, setError } = useUIStore();

  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [expectedHead, setExpectedHead] = useState("");
  const [activeTopTab, setActiveTopTab] = useState<TopTab>("work");
  const [showCommit, setShowCommit] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const isMain = branchName === "main";
  const isContextReady = targetId !== "" && dbName !== "" && branchName !== "";

  // Prevent body scroll when modal is open
  const anyModalOpen = showCommit || showSubmit;
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
        // Only apply if branch hasn't changed since request was made
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
      setError("Discard draft before syncing.");
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

  const label = stateLabel(baseState);

  // Count tables with pending changes
  const tablesWithChanges = new Set(ops.map((op) => op.table));

  return (
    <div className="app-layout">
      {/* Unified Header: State badge + Context + HEAD + Request badge */}
      <header className="unified-header">
        <div className="header-left">
          <span className={`state-badge ${label.className}`}>{label.text}</span>
        </div>
        <div className="header-center">
          <ContextSelector />
        </div>
        <div className="header-right">
          {expectedHead && (
            <span className="head-hash">HEAD: {expectedHead.substring(0, 7)}</span>
          )}
          {requestPending && (
            <button
              className="badge badge-info"
              onClick={() => setActiveTopTab("requests")}
              style={{ cursor: "pointer", border: "none" }}
            >
              📋 Requests
            </button>
          )}
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {!isContextReady ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#888",
          }}
        >
          Select a target, database, and branch to get started.
        </div>
      ) : (
        <>
          {/* Top tab bar */}
          <div className="tab-bar">
            <button
              className={activeTopTab === "work" ? "active" : ""}
              onClick={() => setActiveTopTab("work")}
            >
              Work
            </button>
            <button
              className={activeTopTab === "history" ? "active" : ""}
              onClick={() => setActiveTopTab("history")}
            >
              History
            </button>
            <button
              className={activeTopTab === "requests" ? "active" : ""}
              onClick={() => setActiveTopTab("requests")}
              style={requestPending ? { color: "#3730a3", fontWeight: 600 } : undefined}
            >
              Requests {requestPending ? "●" : ""}
            </button>
          </div>

          {/* Work tab */}
          {activeTopTab === "work" && (
            <div className="work-content">
              {/* Conflict alert banner (inline, only when conflicts exist) */}
              {baseState === "MergeConflictsPresent" && (
                <div className="conflict-banner">
                  <strong>⚠ Merge Conflicts Detected</strong>
                  <p>Conflicts must be resolved to continue. Click below to resolve.</p>
                  <button
                    className="primary"
                    onClick={() => setBaseState("MergeConflictsPresent")}
                    style={{ fontSize: 12, padding: "4px 12px" }}
                  >
                    Resolve Conflicts
                  </button>
                </div>
              )}

              {/* Unified Toolbar: Table selector + Pagination + Action buttons */}
              <div className="unified-toolbar">
                <div className="toolbar-left">
                  <label style={{ fontSize: 12, fontWeight: 600, marginRight: 6 }}>Table</label>
                  <select
                    value={selectedTable}
                    onChange={(e) => setSelectedTable(e.target.value)}
                    style={{ fontSize: 13 }}
                  >
                    {tables.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name} {tablesWithChanges.has(t.name) ? "●" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="toolbar-center">
                  {/* Pagination placeholder - will be implemented by TableGrid */}
                </div>
                <div className="toolbar-right">
                  {!isMain ? (
                    <>
                      <button
                        onClick={handleSync}
                        disabled={
                          hasDraft() ||
                          baseState === "Syncing" ||
                          baseState === "Committing" ||
                          baseState === "MergeConflictsPresent" ||
                          baseState === "SchemaConflictDetected" ||
                          baseState === "ConstraintViolationDetected"
                        }
                      >
                        Sync
                      </button>
                      <button
                        className="primary"
                        onClick={() => setShowCommit(true)}
                        disabled={
                          !hasDraft() ||
                          baseState === "Committing" ||
                          baseState === "Syncing" ||
                          baseState === "StaleHeadDetected" ||
                          baseState === "MergeConflictsPresent" ||
                          baseState === "SchemaConflictDetected" ||
                          baseState === "ConstraintViolationDetected"
                        }
                      >
                        Commit ({ops.length})
                      </button>
                      <button
                        onClick={() => setShowSubmit(true)}
                        disabled={hasDraft() || baseState !== "Idle"}
                      >
                        Submit
                      </button>
                      <button onClick={handleRefresh}>Refresh</button>
                    </>
                  ) : (
                    <span style={{ fontSize: 13, color: "#666" }}>
                      main is read-only
                    </span>
                  )}
                </div>
              </div>

              {/* Table Grid (full width, max height) */}
              <div className="grid-container">
                {selectedTable && <TableGrid tableName={selectedTable} refreshKey={refreshKey} />}
              </div>

              {/* ConflictView overlay (shown when resolving conflicts) */}
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

          {/* History tab */}
          {activeTopTab === "history" && (
            <div className="content-area">
              <HistoryTab />
            </div>
          )}

          {/* Requests tab: approval inbox */}
          {activeTopTab === "requests" && (
            <div className="content-area">
              <ApproverInbox />
            </div>
          )}
        </>
      )}

      {/* Modals */}
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
      {/* CLI intervention screen for fatal states */}
      <CLIRunbook />
    </div>
  );
}

export default App;
