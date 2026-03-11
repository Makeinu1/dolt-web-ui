import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";
import { ApiError } from "../../api/errors";
import type {
  CrossCopyAdminCleanupImportResult,
  CrossCopyAdminPrepareTableResult,
  CrossCopyTableResult,
  Database,
  ExpandColumn,
} from "../../types/api";
import { isCompleted, operationMessage } from "../../utils/apiResult";
import { waitForBranchReady } from "../../utils/branchRecovery";
import { CrossCopyAdminPanel } from "./CrossCopyAdminPanel";

interface CrossCopyTableModalProps {
  tableName: string;
  onClose: () => void;
}

function extractExpandColumns(details: unknown): ExpandColumn[] {
  if (!details || typeof details !== "object") {
    return [];
  }
  const maybeColumns = (details as { expand_columns?: unknown }).expand_columns;
  if (!Array.isArray(maybeColumns)) {
    return [];
  }
  return maybeColumns.filter((value): value is ExpandColumn => (
    !!value &&
    typeof value === "object" &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { src_type?: unknown }).src_type === "string" &&
    typeof (value as { dst_type?: unknown }).dst_type === "string"
  ));
}

export function CrossCopyTableModal({
  tableName,
  onClose,
}: CrossCopyTableModalProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const setSuccess = useUIStore((s) => s.setSuccess);
  const sourceBranch = branchName;

  const [databases, setDatabases] = useState<Database[]>([]);
  const [destDB, setDestDB] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CrossCopyTableResult | null>(null);
  const [existingBranchName, setExistingBranchName] = useState<string | null>(null);
  const [expandColumns, setExpandColumns] = useState<ExpandColumn[]>([]);
  const [adminLoading, setAdminLoading] = useState<"prepare" | "cleanup" | null>(null);
  const [adminResult, setAdminResult] = useState<CrossCopyAdminPrepareTableResult | CrossCopyAdminCleanupImportResult | null>(null);
  const [switchInfo, setSwitchInfo] = useState<string | null>(null);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const importBranchName = `wi/import-${dbName}-${tableName}`;

  // Load databases on mount
  useEffect(() => {
    api
      .getDatabases(targetId)
      .then((dbs) => {
        const filtered = dbs.filter((d) => d.name !== dbName);
        setDatabases(filtered);
        if (filtered.length > 0) setDestDB(filtered[0].name);
      })
      .catch(() => setError("データベースの読み込みに失敗しました"));
  }, [targetId, dbName]);

  useEffect(() => {
    setExpandColumns([]);
    setExistingBranchName(null);
    setAdminResult(null);
  }, [destDB]);

  const handleExecute = async () => {
    setLoading(true);
    setError(null);
    setExistingBranchName(null);
    setExpandColumns([]);
    setAdminResult(null);
    setSwitchInfo(null);
    try {
      const res = await api.crossCopyTable({
        target_id: targetId,
        source_db: dbName,
        source_branch: sourceBranch,
        source_table: tableName,
        dest_db: destDB,
      });
      setResult(res);
      if (isCompleted(res)) {
        setSuccess(operationMessage(res, "他DBへテーブルをコピーしました"));
      } else {
        setError(operationMessage(res, "テーブルコピーを完了できませんでした"));
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === "PRECONDITION_FAILED") {
        setExpandColumns(extractExpandColumns(err.details));
        setError(null);
        return;
      }
      if (err instanceof ApiError && err.code === "BRANCH_EXISTS") {
        const details =
          err.details && typeof err.details === "object"
            ? (err.details as Record<string, unknown>)
            : {};
        const branchName =
          typeof details.branch_name === "string" ? details.branch_name : null;
        setExistingBranchName(branchName ?? importBranchName);
        setError(null);
        return;
      }
      const msg =
        err instanceof ApiError ? err.message : "テーブルコピーに失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleAdminPrepare = async () => {
    setAdminLoading("prepare");
    setError(null);
    try {
      const res = await api.crossCopyAdminPrepareTable({
        target_id: targetId,
        source_db: dbName,
        source_branch: sourceBranch,
        source_table: tableName,
        dest_db: destDB,
      });
      setAdminResult(res);
      if (isCompleted(res)) {
        setExpandColumns([]);
      }
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "schema prep に失敗しました");
    } finally {
      setAdminLoading(null);
    }
  };

  const handleAdminCleanup = async () => {
    const branchName = existingBranchName ?? importBranchName;
    setAdminLoading("cleanup");
    setError(null);
    try {
      const res = await api.crossCopyAdminCleanupImport({
        target_id: targetId,
        dest_db: destDB,
        branch_name: branchName,
      });
      setAdminResult(res);
      if (isCompleted(res)) {
        setExistingBranchName(null);
      }
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "stale import branch の掃除に失敗しました");
    } finally {
      setAdminLoading(null);
    }
  };

  const handleSwitchContext = async () => {
    const branchToOpen = result?.branch_name || existingBranchName;
    if (!branchToOpen) return;
    if (useDraftStore.getState().hasDraft()) {
      if (!window.confirm("未保存の変更があります。破棄して切り替えますか？")) return;
    }
    setSwitchingBranch(true);
    setError(null);
    setSwitchInfo("ブランチの接続反映を確認しています...");
    const ready = await waitForBranchReady({
      targetId,
      dbName: destDB,
      branchName: branchToOpen,
      refreshBranches: () => api.getBranches(targetId, destDB),
    });
    if (!ready) {
      setSwitchingBranch(false);
      setSwitchInfo(null);
      setError("宛先ブランチの接続反映を確認できませんでした。時間をおいて再度開いてください。");
      return;
    }
    const ctx = useContextStore.getState();
    ctx.setDatabase(destDB);
    ctx.setBranch(branchToOpen);
    setSwitchingBranch(false);
    setSwitchInfo(null);
    onClose();
  };

  const adminPreparedColumns =
    adminResult && "prepared_columns" in adminResult ? adminResult.prepared_columns ?? [] : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ minWidth: 450, maxWidth: 600 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>他DBへテーブルコピー</h2>
          <button
            onClick={onClose}
            style={{
              fontSize: 18,
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {/* Source info */}
        <div
          style={{
            fontSize: 12,
            color: "#666",
            marginBottom: 12,
            padding: "4px 8px",
            background: "#f8fafc",
            borderRadius: 4,
          }}
        >
          コピー元: {dbName} / {sourceBranch} / {tableName}
        </div>

        {error && (
          <div
            style={{
              padding: "6px 10px",
              background: "#fee2e2",
              color: "#991b1b",
              fontSize: 12,
              borderRadius: 4,
              marginBottom: 8,
            }}
          >
            {error}
          </div>
        )}
        {switchInfo && (
          <div
            style={{
              padding: "6px 10px",
              background: "#eff6ff",
              color: "#1d4ed8",
              fontSize: 12,
              borderRadius: 4,
              marginBottom: 8,
            }}
          >
            {switchInfo}
          </div>
        )}

        {!result ? (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                宛先DB
              </label>
              <select
                value={destDB}
                onChange={(e) => setDestDB(e.target.value)}
                style={{ width: "100%", padding: "4px 8px", fontSize: 13 }}
              >
                {databases.length === 0 && (
                  <option value="">他のDBがありません</option>
                )}
                {databases.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                padding: "8px 10px",
                background: "#fffbeb",
                color: "#92400e",
                fontSize: 12,
                borderRadius: 4,
                marginBottom: 16,
              }}
            >
              宛先テーブルの全データが上書きされます
            </div>

            {(expandColumns.length > 0 || existingBranchName || adminResult) && (
              <CrossCopyAdminPanel
                title={
                  expandColumns.length > 0
                    ? "schema prep が必要"
                    : existingBranchName
                      ? "stale import branch を掃除"
                      : "管理レーンの結果"
                }
                description={
                  expandColumns.length > 0
                    ? "normal flow はここで止まります。destination main の schema を準備してから、コピーを再実行してください。"
                    : existingBranchName
                      ? `同じコピー元の import branch が残っています。対象 branch: ${existingBranchName}。開いて続行するか、管理レーンで掃除してから再実行してください。`
                      : "管理レーンの結果を確認してから、必要ならコピーを再実行してください。"
                }
                preparedColumns={expandColumns.length > 0 ? expandColumns : adminPreparedColumns}
                result={adminResult}
                actions={
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    {existingBranchName && (
                      <button
                        onClick={() => void handleSwitchContext()}
                        disabled={switchingBranch || adminLoading !== null}
                        style={{
                          padding: "6px 12px",
                          fontSize: 12,
                          background: "#f8fafc",
                          color: "#334155",
                          border: "1px solid #cbd5e1",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                      >
                        {switchingBranch ? "接続反映待ち..." : "既存ブランチを開く"}
                      </button>
                    )}
                    {existingBranchName && (
                      <button
                        onClick={() => void handleAdminCleanup()}
                        disabled={loading || adminLoading !== null}
                        style={{
                          padding: "6px 12px",
                          fontSize: 12,
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          border: "1px solid #bfdbfe",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                      >
                        {adminLoading === "cleanup" ? "掃除中..." : "stale import branch を掃除する"}
                      </button>
                    )}
                    {expandColumns.length > 0 && (
                      <button
                        className="primary"
                        onClick={() => void handleAdminPrepare()}
                        disabled={loading || adminLoading !== null}
                        style={{ padding: "6px 12px", fontSize: 12 }}
                      >
                        {adminLoading === "prepare" ? "schema prep 中..." : "schema を準備する"}
                      </button>
                    )}
                  </div>
                }
              />
            )}

            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button
                onClick={onClose}
                style={{
                  padding: "6px 16px",
                  fontSize: 13,
                  background: "#f1f5f9",
                  color: "#334155",
                  border: "1px solid #cbd5e1",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                キャンセル
              </button>
              <button
                className="primary"
                onClick={handleExecute}
                disabled={loading || adminLoading !== null || !destDB || databases.length === 0}
                style={{ padding: "6px 16px", fontSize: 13 }}
              >
                {loading ? "コピー中..." : "コピー実行"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div
              style={{
                padding: "12px 16px",
                background: isCompleted(result) ? "#f0fdf4" : "#eff6ff",
                borderRadius: 4,
                marginBottom: 12,
                fontSize: 13,
                color: isCompleted(result) ? "#166534" : "#1d4ed8",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {operationMessage(result, isCompleted(result) ? "コピー完了" : "コピーを完了できませんでした")}
              </div>
              {result.branch_name && (
                <div>ブランチ: {result.branch_name}</div>
              )}
              <div>{result.row_count.toLocaleString()}行</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                共有カラム: {result.shared_columns.length}
                {result.source_only_columns.length > 0 &&
                  ` / コピー元のみ: ${result.source_only_columns.length}`}
                {result.dest_only_columns.length > 0 &&
                  ` / 宛先のみ: ${result.dest_only_columns.length}`}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={onClose}
                style={{
                  padding: "6px 16px",
                  fontSize: 13,
                  background: "#f1f5f9",
                  color: "#334155",
                  border: "1px solid #cbd5e1",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                閉じる
              </button>
              <button
                className="primary"
                onClick={() => void handleSwitchContext()}
                disabled={switchingBranch || !result.branch_name}
                style={{ padding: "6px 16px", fontSize: 13 }}
              >
                {switchingBranch
                  ? "接続反映待ち..."
                  : result.branch_name
                    ? "宛先に切り替え"
                    : "閉じる"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
