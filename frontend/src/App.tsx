import { useCallback, useEffect, useState } from "react";
import { useContextStore } from "./store/context";
import { useDraftStore } from "./store/draft";
import { useUIStore, type BaseState } from "./store/ui";
import { ContextSelector } from "./components/ContextSelector/ContextSelector";
import { TableGrid } from "./components/TableGrid/TableGrid";
import { TemplateBar } from "./components/TemplateBar/TemplateBar";
import { ChangedView } from "./components/ChangedView/ChangedView";
import { CommitDialog } from "./components/common/CommitDialog";
import { DiffViewer } from "./components/DiffViewer/DiffViewer";
import { ConflictView } from "./components/ConflictView/ConflictView";
import { SubmitDialog, ApproverInbox } from "./components/RequestDialog/RequestDialog";
import * as api from "./api/client";
import type { Table, ColumnSchema } from "./types/api";
import "./App.css";

type TabId = "grid" | "changed" | "diff" | "conflicts" | "requests";

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
  const { targetId, dbName, branchName } = useContextStore();
  const { ops, loadDraft, hasDraft } = useDraftStore();
  const { baseState, requestPending, error, setBaseState, setRequestPending, setError } =
    useUIStore();

  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [pkColumn, setPkColumn] = useState("");
  const [expectedHead, setExpectedHead] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("grid");
  const [showCommit, setShowCommit] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);

  const isMain = branchName === "main";
  const isContextReady = targetId !== "" && dbName !== "" && branchName !== "";

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
      .catch(console.error);
  }, [targetId, dbName, branchName, isContextReady]);

  // Load HEAD hash
  const refreshHead = useCallback(() => {
    if (!isContextReady) return;
    api
      .getHead(targetId, dbName, branchName)
      .then((h) => setExpectedHead(h.hash))
      .catch(console.error);
  }, [targetId, dbName, branchName, isContextReady]);

  useEffect(() => {
    refreshHead();
  }, [refreshHead]);

  // Load PK column for selected table
  useEffect(() => {
    if (!selectedTable || !isContextReady) return;
    api
      .getTableSchema(targetId, dbName, branchName, selectedTable)
      .then((schema) => {
        const pk = schema.columns.find((c: ColumnSchema) => c.primary_key);
        setPkColumn(pk?.name || "");
      })
      .catch(console.error);
  }, [targetId, dbName, branchName, selectedTable, isContextReady]);

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
        setActiveTab("conflicts");
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
  };

  const onConflictResolved = (newHash: string) => {
    setExpectedHead(newHash);
    setActiveTab("grid");
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
          {/* Tab bar */}
          <div className="tab-bar">
            <button
              className={activeTab === "grid" ? "active" : ""}
              onClick={() => setActiveTab("grid")}
            >
              All View
            </button>
            <button
              className={activeTab === "changed" ? "active" : ""}
              onClick={() => setActiveTab("changed")}
            >
              Changed
              {ops.length > 0 && <span className="draft-count">{ops.length}</span>}
            </button>
            <button
              className={activeTab === "diff" ? "active" : ""}
              onClick={() => setActiveTab("diff")}
            >
              Diff
            </button>
            <button
              className={activeTab === "conflicts" ? "active" : ""}
              onClick={() => setActiveTab("conflicts")}
            >
              Conflicts
            </button>
            <button
              className={activeTab === "requests" ? "active" : ""}
              onClick={() => setActiveTab("requests")}
            >
              Requests
            </button>
          </div>

          {/* Toolbar */}
          <div className="toolbar">
            <div>
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
            </div>
            <div className="spacer" />
            {!isMain && (
              <>
                <button
                  onClick={handleSync}
                  disabled={
                    hasDraft() ||
                    baseState === "Syncing" ||
                    baseState === "Committing"
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
                    baseState === "StaleHeadDetected"
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
              </>
            )}
            <button onClick={handleRefresh}>Refresh</button>
          </div>

          {/* Template bar (only on grid tab, non-main) */}
          {activeTab === "grid" && !isMain && selectedTable && pkColumn && (
            <TemplateBar tableName={selectedTable} pkColumn={pkColumn} />
          )}

          {/* Content area */}
          <div className="content-area">
            {activeTab === "grid" && selectedTable && (
              <TableGrid tableName={selectedTable} />
            )}
            {activeTab === "changed" && <ChangedView />}
            {activeTab === "diff" && selectedTable && (
              <DiffViewer
                tableName={selectedTable}
                fromRef="main"
                toRef={branchName}
              />
            )}
            {activeTab === "conflicts" && (
              <ConflictView
                expectedHead={expectedHead}
                onResolved={onConflictResolved}
              />
            )}
            {activeTab === "requests" && <ApproverInbox />}
          </div>
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
    </div>
  );
}

export default App;
