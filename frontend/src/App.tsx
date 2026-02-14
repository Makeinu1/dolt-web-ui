import { useCallback, useEffect, useRef, useState } from "react";
import { useContextStore } from "./store/context";
import { useDraftStore } from "./store/draft";
import { useUIStore, type BaseState } from "./store/ui";
import { ContextSelector } from "./components/ContextSelector/ContextSelector";
import { TableGrid } from "./components/TableGrid/TableGrid";
import { PKSearchBar } from "./components/PKSearchBar/PKSearchBar";
import { ChangedView } from "./components/ChangedView/ChangedView";
import { DiffViewer } from "./components/DiffViewer/DiffViewer";
import { CommitDialog } from "./components/common/CommitDialog";
import { ConflictView } from "./components/ConflictView/ConflictView";
import { SubmitDialog, ApproverInbox } from "./components/RequestDialog/RequestDialog";
import { CLIRunbook } from "./components/CLIRunbook/CLIRunbook";
import * as api from "./api/client";
import type { Table } from "./types/api";
import "./App.css";

type TopTab = "work" | "conflicts" | "requests";

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
  const { baseState, requestPending, error, drawerOpen, setBaseState, setRequestPending, setError, toggleDrawer, closeDrawer } =
    useUIStore();

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
        setActiveTopTab("conflicts");
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
    setActiveTopTab("work");
  };

  const label = stateLabel(baseState);

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="app-header">
        <h1>Dolt Web UI</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {expectedHead && (
            <span className="head-hash">HEAD: {expectedHead.substring(0, 12)}</span>
          )}
          {requestPending && (
            <span className="badge badge-info">Request Pending</span>
          )}
        </div>
      </header>

      {/* Context selector */}
      <ContextSelector />

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
              className={activeTopTab === "conflicts" ? "active" : ""}
              onClick={() => setActiveTopTab("conflicts")}
            >
              Conflicts
            </button>
            <button
              className={activeTopTab === "requests" ? "active" : ""}
              onClick={() => setActiveTopTab("requests")}
            >
              Requests
            </button>
          </div>

          {/* Work tab: grid + optional drawer */}
          {activeTopTab === "work" && (
            <>
              <div className="work-area">
                {/* Main grid area (full width when drawer closed) */}
                <div className="grid-pane">
                  <div className="grid-toolbar">
                    <label style={{ fontSize: 12, fontWeight: 600, marginRight: 8 }}>Table</label>
                    <select
                      value={selectedTable}
                      onChange={(e) => setSelectedTable(e.target.value)}
                    >
                      {tables.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <div className="toolbar-spacer" />
                    {!isMain && (
                      <>
                        <button
                          className={`toolbar-btn ${drawerOpen === "changed" ? "toolbar-btn-active" : ""}`}
                          onClick={() => toggleDrawer("changed")}
                        >
                          Changed
                          {ops.length > 0 && <span className="toolbar-badge">{ops.length}</span>}
                        </button>
                        <button
                          className={`toolbar-btn ${drawerOpen === "diff" ? "toolbar-btn-active" : ""}`}
                          onClick={() => toggleDrawer("diff")}
                        >
                          Diff
                        </button>
                      </>
                    )}
                  </div>
                  {selectedTable && <PKSearchBar tableName={selectedTable} />}
                  {selectedTable && <TableGrid tableName={selectedTable} refreshKey={refreshKey} />}
                </div>

                {/* Right drawer (push style) */}
                {drawerOpen && (
                  <div className="drawer">
                    <div className="drawer-header">
                      <span className="drawer-title">
                        {drawerOpen === "changed" ? `Changed (${ops.length})` : "Diff"}
                      </span>
                      <button className="drawer-close" onClick={closeDrawer}>
                        &times;
                      </button>
                    </div>
                    <div className="drawer-content">
                      {drawerOpen === "changed" && <ChangedView />}
                      {drawerOpen === "diff" && (
                        selectedTable ? (
                          <DiffViewer tableName={selectedTable} fromRef="main" toRef={branchName} />
                        ) : (
                          <div style={{ padding: 24, color: "#888", textAlign: "center", fontSize: 13 }}>
                            Select a table to view diff.
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Read-only banner for main */}
              {isMain && (
                <div className="action-bar" style={{ background: "#f0f0f5", justifyContent: "center" }}>
                  <span style={{ fontSize: 13, color: "#666" }}>
                    main is read-only. Create a work branch to edit.
                  </span>
                </div>
              )}

              {/* Action bar */}
              {!isMain && (
                <div className="action-bar">
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
                    Sync from Main
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
                    disabled={
                      hasDraft() ||
                      baseState !== "Idle"
                    }
                  >
                    Submit Request
                  </button>
                  <div className="spacer" />
                  <button onClick={handleRefresh}>Refresh</button>
                  {hasDraft() && (
                    <span style={{ fontSize: 12, color: "#92400e" }}>
                      {ops.length} pending ops
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          {/* Conflicts tab: full width */}
          {activeTopTab === "conflicts" && (
            <div className="content-area">
              <ConflictView
                expectedHead={expectedHead}
                onResolved={onConflictResolved}
              />
            </div>
          )}

          {/* Requests tab: full width */}
          {activeTopTab === "requests" && (
            <div className="content-area">
              <ApproverInbox />
            </div>
          )}
        </>
      )}

      {/* Status bar */}
      <div className="status-bar">
        <span className={`state-badge ${label.className}`}>{label.text}</span>
        {isContextReady && (
          <span>
            {targetId} / {dbName} / {branchName}
          </span>
        )}
        {hasDraft() && <span>{ops.length} pending ops</span>}
      </div>

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
