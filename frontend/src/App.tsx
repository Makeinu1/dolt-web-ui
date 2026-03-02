import { useEffect, useMemo, useRef, useState } from "react";
import { useContextStore } from "./store/context";
import { useDraftStore } from "./store/draft";
import { useUIStore, type BaseState } from "./store/ui";
import { ContextSelector } from "./components/ContextSelector/ContextSelector";
import { TableGrid } from "./components/TableGrid/TableGrid";
import { ConflictView } from "./components/ConflictView/ConflictView";
import { CLIRunbook } from "./components/CLIRunbook/CLIRunbook";
import { ModalManager } from "./components/ModalManager/ModalManager";
import { useHeadSync } from "./hooks/useHeadSync";
import * as api from "./api/client";
import { ApiError } from "./api/errors";
import type { Table, OverwrittenTable } from "./types/api";
import type { SelectedCellInfo } from "./components/TableGrid/TableGrid";
import { CrossCopyRowsModal } from "./components/CrossCopyModal/CrossCopyRowsModal";
import { CrossCopyTableModal } from "./components/CrossCopyModal/CrossCopyTableModal";
import { RecordHistoryPopup } from "./components/common/RecordHistoryPopup";
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
      return { text: "保存中...", className: "state-draft" };
    case "Syncing":
      return { text: "同期中...", className: "state-draft" };
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
  const { baseState, requestCount, error, setBaseState, setRequestCount, setError } = useUIStore();

  const [tables, setTables] = useState<Table[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [selectedTable, setSelectedTable] = useState("");
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
  const [showMergeLog, setShowMergeLog] = useState(false);
  const [overwrittenTables, setOverwrittenTables] = useState<OverwrittenTable[]>([]);
  const [showCrossCopyRows, setShowCrossCopyRows] = useState(false);
  const [crossCopyPKs, setCrossCopyPKs] = useState<string[]>([]);
  const [showCrossCopyTable, setShowCrossCopyTable] = useState(false);
  const [showRowHistory, setShowRowHistory] = useState(false);
  const [rowHistoryInfo, setRowHistoryInfo] = useState<{ table: string; pk: string } | null>(null);


  const isMain = branchName === "main";
  const isAudit = branchName === "audit";
  const isProtected = isMain || isAudit;
  const isContextReady = targetId !== "" && dbName !== "" && branchName !== "";

  // Prevent body scroll when modal is open
  const anyModalOpen = showCommit || showSubmit || showApprover || showHistory || showDeleteConfirm || showMergeLog || showCrossCopyRows || showCrossCopyTable || showRowHistory;

  useEffect(() => {
    if (anyModalOpen) {
      document.body.classList.add("modal-open");
    } else {
      document.body.classList.remove("modal-open");
    }
    return () => document.body.classList.remove("modal-open");
  }, [anyModalOpen]);

  // Load draft from sessionStorage
  const hasDraft = useDraftStore((s) => s.hasDraft);
  const loadDraft = useDraftStore((s) => s.loadDraft);
  const clearDraft = useDraftStore((s) => s.clearDraft);
  const ops = useDraftStore((s) => s.ops);

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
    setTablesLoading(true);
    api
      .getTables(targetId, dbName, branchName)
      .then((t) => {
        setTables(t);
        if (t.length > 0 && !selectedTable) {
          setSelectedTable(t[0].name);
        }
      })
      .catch((err) => {
        const msg = err instanceof ApiError ? err.message : "テーブルの読み込みに失敗しました";
        setError(msg);
      })
      .finally(() => setTablesLoading(false));
  }, [targetId, dbName, branchName, isContextReady]);

  // C-3: React to context changes to clear draft and reset UI state.
  // Previously this was done inside context.ts by calling other stores directly
  // (tight coupling). Now each store is independent; we handle side-effects here.
  const prevContextRef = useRef({ targetId, dbName, branchName });
  useEffect(() => {
    const prev = prevContextRef.current;
    const targetChanged = prev.targetId !== targetId;
    const dbChanged = prev.dbName !== dbName;
    const branchChanged = prev.branchName !== branchName && prev.branchName !== "";
    if (targetChanged || dbChanged || branchChanged) {
      clearDraft();
      setBaseState("Idle");
      setError(null);
    }
    prevContextRef.current = { targetId, dbName, branchName };
  }, [targetId, dbName, branchName, clearDraft, setBaseState, setError]);

  // C-1: Delegate HEAD management to the useHeadSync hook
  const { expectedHead, setExpectedHead, refreshHead } = useHeadSync({
    targetId,
    dbName,
    branchName,
    branchRefreshKey,
    isContextReady,
    onError: (msg) => setError(msg),
  });

  // Refresh data when branchRefreshKey changes (e.g. after approve/reject)
  useEffect(() => {
    if (branchRefreshKey > 0) {
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
  }, [targetId, dbName, branchRefreshKey, isContextReady]);

  // Update base state based on draft
  useEffect(() => {
    if (hasDraft() && baseState === "Idle") {
      setBaseState("DraftEditing");
    }
  }, [ops, baseState, hasDraft, setBaseState]);

  const handleSync = async () => {
    if (baseState === "Syncing") return;
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
      // Data conflicts were auto-resolved (main priority) — notify user
      if (result.overwritten_tables && result.overwritten_tables.length > 0) {
        setOverwrittenTables(result.overwritten_tables);
      }
    } catch (err: unknown) {
      // ApiError carries flat .code and .message fields
      const code = err instanceof ApiError ? err.code : (err as { code?: string })?.code;
      const message = err instanceof ApiError ? err.message : (err as { message?: string })?.message;
      if (code === "BRANCH_LOCKED") {
        setBaseState("Idle");
        setError("承認申請中のためロックされています");
      } else if (code === "SCHEMA_CONFLICTS_PRESENT") {
        setBaseState("SchemaConflictDetected");
        setError("同期に失敗しました" + (message ? ": " + message : ""));
      } else if (code === "CONSTRAINT_VIOLATIONS_PRESENT") {
        setBaseState("ConstraintViolationDetected");
        setError("同期に失敗しました" + (message ? ": " + message : ""));
      } else if (code === "STALE_HEAD") {
        setBaseState("StaleHeadDetected");
        setError("同期に失敗しました" + (message ? ": " + message : ""));
      } else {
        setBaseState("Idle");
        setError("同期に失敗しました" + (message ? ": " + message : ""));
      }
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
    if (!branchName || isProtected) return;
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
      const msg = err instanceof ApiError ? err.message : "";
      setError("ブランチの削除に失敗しました" + (msg ? ": " + msg : ""));
    } finally {
      setDeleting(false);
    }
  };

  const onCommitSuccess = (newHash: string) => {
    setExpectedHead(newHash);
    setRefreshKey((k) => k + 1);
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
    if (isProtected) return null;
    if (baseState === "StaleHeadDetected") {
      return (
        <button className="action-btn action-refresh" onClick={handleRefresh}>
          ↻ 更新して同期
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

    if (!isProtected) {
      // Sync
      const syncDisabled = hasDraft() || baseState === "Syncing" || baseState === "Committing" ||
        baseState === "SchemaConflictDetected" || baseState === "ConstraintViolationDetected";
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
          ? (hasDraft() ? "先に保存してください" : "待機状態でないと申請できません")
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

    // Merge Log
    items.push({
      label: "📋 マージログ",
      onClick: () => { setShowMergeLog(true); setShowOverflow(false); },
    });

    // Cross-DB Table Copy
    if (selectedTable) {
      items.push({
        label: "他DBへテーブルコピー",
        onClick: () => { setShowCrossCopyTable(true); setShowOverflow(false); },
      });
    }

    // Delete Branch (work branches only)
    if (!isProtected && branchName) {
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
          <span
            className={`state-badge ${label.className}`}
            onClick={baseState === "StaleHeadDetected" ? handleRefresh : undefined}
            style={baseState === "StaleHeadDetected" ? { cursor: "pointer" } : undefined}
            title={baseState === "StaleHeadDetected" ? "クリックで更新" : undefined}
          >{label.text}</span>
          <ContextSelector />
          {/* Table selector */}
          {isContextReady && (tablesLoading || tables.length > 0) && (
            <select
              className="header-table-select"
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              disabled={tablesLoading}
            >
              {tablesLoading ? (
                <option>読み込み中...</option>
              ) : (
                tables.map((t) => {
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
                })
              )}
            </select>
          )}
        </div>

        <div className="header-right">
          {/* State-driven action button */}
          {hasDraft() && (
            <button
              className="toolbar-btn"
              style={{ fontSize: 13, color: '#DC2626', background: '#FEE2E2', border: '1px solid #FECACA', padding: '4px 12px', marginRight: 8, borderRadius: 4 }}
              onClick={() => {
                if (window.confirm("現在のドラフト（未保存の変更）をすべて破棄します。よろしいですか？")) {
                  clearDraft();
                  setBaseState("Idle");
                  setRefreshKey(k => k + 1);
                }
              }}
              title="すべての未保存の変更を破棄する"
            >
              変更をクリア
            </button>
          )}

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
          {baseState !== "StaleHeadDetected" && (
            <button onClick={() => setError(null)}>✕</button>
          )}
        </div>
      )}

      {!isContextReady ? (
        <div className="empty-state">
          ターゲット、データベース、ブランチを選択してください。
        </div>
      ) : (
        <div className="work-content">
          {/* Grid fills all remaining space */}
          <div className="grid-container">
            {selectedTable && (
              <TableGrid
                tableName={selectedTable}
                refreshKey={refreshKey}
                onCellSelected={(info) => {
                  setSelectedCell(info);
                  if (!info) setShowCommentPanel(false);
                }}
                onCrossCopyRows={!isProtected ? (pks) => {
                  setCrossCopyPKs(pks);
                  setShowCrossCopyRows(true);
                } : undefined}
                onShowRowHistory={(table, pk) => {
                  setRowHistoryInfo({ table, pk });
                  setShowRowHistory(true);
                }}
              />
            )}
          </div>

          {/* Overwrite notification overlay (shown after auto-resolved sync conflicts) */}
          {overwrittenTables.length > 0 && (
            <div className="conflict-overlay" onClick={() => setOverwrittenTables([])}>
              <div onClick={(e) => e.stopPropagation()}>
                <ConflictView
                  overwrittenTables={overwrittenTables}
                  onDismiss={() => setOverwrittenTables([])}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* === Modals & Panels (C-2: delegated to ModalManager) === */}
      <ModalManager
        targetId={targetId}
        dbName={dbName}
        branchName={branchName}
        expectedHead={expectedHead}
        showCommit={showCommit}
        showSubmit={showSubmit}
        showApprover={showApprover}
        showHistory={showHistory}
        showDeleteConfirm={showDeleteConfirm}
        showCommentPanel={showCommentPanel}
        showMergeLog={showMergeLog}
        onCloseCommit={() => setShowCommit(false)}
        onCloseSubmit={() => setShowSubmit(false)}
        onCloseApprover={() => setShowApprover(false)}
        onCloseHistory={() => setShowHistory(false)}
        onCloseDeleteConfirm={() => setShowDeleteConfirm(false)}
        onCloseCommentPanel={() => setShowCommentPanel(false)}
        onCloseMergeLog={() => setShowMergeLog(false)}
        onCommitSuccess={onCommitSuccess}
        onSubmitted={() => setRequestCount(requestCount + 1)}
        onDeleteConfirm={handleDeleteBranch}
        deleting={deleting}
        selectedCell={selectedCell}
      />

      {/* Cross-DB Copy Modals */}
      {showCrossCopyRows && selectedTable && (
        <CrossCopyRowsModal
          tableName={selectedTable}
          selectedPKs={crossCopyPKs}
          onClose={() => setShowCrossCopyRows(false)}
        />
      )}
      {showCrossCopyTable && selectedTable && (
        <CrossCopyTableModal
          tableName={selectedTable}
          onClose={() => setShowCrossCopyTable(false)}
        />
      )}

      {/* Row History Popup */}
      {showRowHistory && rowHistoryInfo && (
        <RecordHistoryPopup
          targetId={targetId}
          dbName={dbName}
          branchName={branchName}
          table={rowHistoryInfo.table}
          pk={rowHistoryInfo.pk}
          onClose={() => { setShowRowHistory(false); setRowHistoryInfo(null); }}
        />
      )}

      {/* CLI intervention screen for fatal states */}
      <CLIRunbook />
    </div>
  );
}

export default App;
