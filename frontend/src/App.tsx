import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { CellCommentPanel } from "./components/CellCommentPanel/CellCommentPanel";
import { CommentSearchModal } from "./components/CommentSearchModal/CommentSearchModal";
import * as api from "./api/client";
import type { Table } from "./types/api";
import type { SelectedCellInfo } from "./components/TableGrid/TableGrid";
import "./App.css";

function stateLabel(state: BaseState): { text: string; className: string } {
  switch (state) {
    case "Idle":
      return { text: "待機中", className: "state-idle" };
    case "DraftEditing":
      return { text: "下書き", className: "state-draft" };
    case "Previewing":
      return { text: "プレビュー中", className: "state-draft" };
    case "Committing":
      return { text: "コミット中...", className: "state-draft" };
    case "Syncing":
      return { text: "同期中...", className: "state-draft" };
    case "MergeConflictsPresent":
      return { text: "コンフリクト", className: "state-conflict" };
    case "SchemaConflictDetected":
      return { text: "スキーマコンフリクト", className: "state-conflict" };
    case "ConstraintViolationDetected":
      return { text: "制約違反", className: "state-conflict" };
    case "StaleHeadDetected":
      return { text: "要更新", className: "state-conflict" };
  }
}

function App() {
  const { targetId, dbName, branchName, branchRefreshKey, setBranch, triggerBranchRefresh } = useContextStore();
  const { ops, loadDraft, hasDraft } = useDraftStore();
  const { baseState, requestCount, error, setBaseState, setRequestCount, setError } = useUIStore();

  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [expectedHead, setExpectedHead] = useState("");
  const [showCommit, setShowCommit] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [showApprover, setShowApprover] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedCell, setSelectedCell] = useState<SelectedCellInfo | null>(null);
  const [showCommentPanel, setShowCommentPanel] = useState(false);
  const [commentRefreshKey, setCommentRefreshKey] = useState(0);
  const [showCommentSearch, setShowCommentSearch] = useState(false);
  const [filterByPk, setFilterByPk] = useState<string | null>(null);

  const isMain = branchName === "main";
  const isContextReady = targetId !== "" && dbName !== "" && branchName !== "";

  // Prevent body scroll when modal is open
  const anyModalOpen = showCommit || showSubmit || showApprover || showHistory || showDeleteConfirm || showCommentSearch;
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
        setError(e?.error?.message || "テーブルの読み込みに失敗しました");
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
          setError(e?.error?.message || "HEADの取得に失敗しました");
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

  // Auto-detect pending approval requests on context change and after approve/reject
  useEffect(() => {
    if (!isContextReady) return;
    api.listRequests(targetId, dbName)
      .then((requests) => {
        setRequestCount(requests.length);
      })
      .catch(() => {
        // silently ignore — non-critical
      });
  }, [targetId, dbName, branchRefreshKey]);

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
      setError(e?.error?.message || "同期に失敗しました");
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

  const handleDeleteBranch = async () => {
    if (!branchName || branchName === "main") return;
    setDeleting(true);
    try {
      await api.deleteBranch({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
      });
      setBranch("main");
      triggerBranchRefresh();
      setShowDeleteConfirm(false);
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "ブランチの削除に失敗しました");
    } finally {
      setDeleting(false);
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

  // Called after comment add/delete: refresh HEAD (immediate commit changed it) and comment markers
  const onCommentChanged = useCallback(() => {
    refreshHead();
    setCommentRefreshKey((k) => k + 1);
  }, [refreshHead]);

  // Navigate to a specific row from comment search
  const handleCommentNavigate = useCallback((table: string, pkValue: string) => {
    setSelectedTable(table);
    setFilterByPk(pkValue);
    setShowCommentSearch(false);
  }, []);

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

  // Count tables with pending changes (insert/update/delete per table)
  const tableChanges = useMemo(
    () =>
      ops.reduce((acc, op) => {
        const cur = acc.get(op.table) ?? { inserts: 0, updates: 0, deletes: 0 };
        if (op.type === "insert") cur.inserts++;
        else if (op.type === "update") cur.updates++;
        else if (op.type === "delete") cur.deletes++;
        acc.set(op.table, cur);
        return acc;
      }, new Map<string, { inserts: number; updates: number; deletes: number }>()),
    [ops]
  );

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
        label: "↻ Main と同期",
        onClick: () => { handleSync(); setShowOverflow(false); },
        disabled: syncDisabled,
        disabledReason: syncDisabled
          ? (hasDraft() ? "ドラフトがあると同期できません" : "処理中は同期できません")
          : undefined,
      });

      // Submit
      const submitDisabled = hasDraft() || baseState !== "Idle";
      items.push({
        label: "📤 承認を申請",
        onClick: () => { setShowSubmit(true); setShowOverflow(false); },
        disabled: submitDisabled,
        disabledReason: submitDisabled
          ? (hasDraft() ? "先にコミットしてください" : "Idle状態でないとSubmitできません")
          : undefined,
      });

      // Refresh
      items.push({
        label: "🔄 最新に更新",
        onClick: () => { handleRefresh(); setShowOverflow(false); },
      });
    }

    // Compare Versions (History)
    items.push({
      label: "📊 バージョン比較...",
      onClick: () => { setShowHistory(true); setShowOverflow(false); },
    });

    // Comment search
    items.push({
      label: "🔍 コメント検索...",
      onClick: () => { setShowCommentSearch(true); setShowOverflow(false); },
    });

    // Delete Branch (non-main only)
    if (!isMain && branchName) {
      items.push({
        label: "🗑 ブランチを削除",
        onClick: () => { setShowDeleteConfirm(true); setShowOverflow(false); },
        danger: true,
      });
    }

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
              {tables.map((t) => {
                const c = tableChanges.get(t.name);
                const indicator = c
                  ? ` (${[
                      c.inserts > 0 ? `+${c.inserts}` : "",
                      c.updates > 0 ? `~${c.updates}` : "",
                      c.deletes > 0 ? `-${c.deletes}` : "",
                    ].filter(Boolean).join(" ")})`
                  : "";
                return (
                  <option key={t.name} value={t.name}>
                    {t.name}{indicator}
                  </option>
                );
              })}
            </select>
          )}
        </div>

        <div className="header-right">
          {/* State-driven action button */}
          {actionButton()}

          {/* Comment panel button */}
          {isContextReady && (
            <button
              className="toolbar-btn"
              style={{ fontSize: 13 }}
              title={selectedCell ? `コメント: ${selectedCell.column}` : "セルを選択してください"}
              disabled={!selectedCell}
              onClick={() => setShowCommentPanel(true)}
            >
              💬
            </button>
          )}

          {/* Approver badge */}
          {requestCount > 0 && (
            <button
              className="approver-badge"
              onClick={() => setShowApprover(true)}
              title="承認待ちリクエストを表示"
            >
              📋 {requestCount}
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
          ターゲット、データベース、ブランチを選択してください。
        </div>
      ) : (
        <div className="work-content">
          {/* Conflict alert banner */}
          {baseState === "MergeConflictsPresent" && (
            <div className="conflict-banner">
              <strong>⚠ マージコンフリクトが検出されました</strong>
              <p>コンフリクトを解決してください。</p>
            </div>
          )}

          {/* Grid fills all remaining space */}
          <div className="grid-container">
            {selectedTable && (
              <TableGrid
                tableName={selectedTable}
                refreshKey={refreshKey}
                commentRefreshKey={commentRefreshKey}
                onCellSelected={(info) => {
                  setSelectedCell(info);
                  if (!info) setShowCommentPanel(false);
                }}
                filterByPk={filterByPk}
              />
            )}
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
          onSubmitted={() => setRequestCount(requestCount + 1)}
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
              <h2 style={{ margin: 0 }}>バージョン比較</h2>
              <button onClick={() => setShowHistory(false)} style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>
            <HistoryTab />
          </div>
        </div>
      )}
      {/* Delete branch confirmation */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal" style={{ minWidth: 380, maxWidth: 450 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>ブランチの削除</h2>
            <p style={{ fontSize: 13, color: "#555", margin: "0 0 16px" }}>
              ブランチ <code style={{ fontSize: 12, background: "#f1f5f9", padding: "1px 4px", borderRadius: 2 }}>{branchName}</code> を完全に削除します。この操作は元に戻せません。
            </p>
            <div className="modal-actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ padding: "6px 16px", fontSize: 13, background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer" }}>
                キャンセル
              </button>
              <button
                onClick={handleDeleteBranch}
                disabled={deleting}
                style={{ padding: "6px 16px", fontSize: 13, background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
              >
                {deleting ? "削除中..." : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Cell comment panel (slide-in panel, not modal overlay) */}
      {showCommentPanel && selectedCell && (
        <CellCommentPanel
          targetId={targetId}
          dbName={dbName}
          branchName={branchName}
          table={selectedCell.table}
          pk={selectedCell.pk}
          column={selectedCell.column}
          onClose={() => setShowCommentPanel(false)}
          onChanged={onCommentChanged}
        />
      )}

      {/* Comment search modal */}
      {showCommentSearch && (
        <CommentSearchModal
          targetId={targetId}
          dbName={dbName}
          branchName={branchName}
          onClose={() => setShowCommentSearch(false)}
          onNavigate={handleCommentNavigate}
        />
      )}

      {/* CLI intervention screen for fatal states */}
      <CLIRunbook />
    </div>
  );
}

export default App;
