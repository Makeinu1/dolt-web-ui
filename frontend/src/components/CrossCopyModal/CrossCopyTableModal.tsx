import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";
import { ApiError } from "../../api/errors";
import type { Database, CrossCopyTableResponse } from "../../types/api";
import { waitForBranchReady } from "../../utils/branchRecovery";

interface CrossCopyTableModalProps {
  tableName: string;
  onClose: () => void;
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
  const [result, setResult] = useState<CrossCopyTableResponse | null>(null);
  const [existingBranchName, setExistingBranchName] = useState<string | null>(null);
  const [switchInfo, setSwitchInfo] = useState<string | null>(null);
  const [switchingBranch, setSwitchingBranch] = useState(false);

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

  const handleExecute = async () => {
    setLoading(true);
    setError(null);
    setExistingBranchName(null);
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
      setSuccess("他DBへテーブルをコピーしました");
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === "BRANCH_EXISTS") {
        const details =
          err.details && typeof err.details === "object"
            ? (err.details as Record<string, unknown>)
            : {};
        const branchName =
          typeof details.branch_name === "string" ? details.branch_name : null;
        setExistingBranchName(branchName);
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

  const handleSwitchContext = async () => {
    const branchToOpen = result?.branch_name ?? existingBranchName;
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

        {!result && !existingBranchName ? (
          /* Input form */
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
                disabled={loading || !destDB || databases.length === 0}
                style={{ padding: "6px 16px", fontSize: 13 }}
              >
                {loading ? "コピー中..." : "コピー実行"}
              </button>
            </div>
          </div>
        ) : (
          /* Result / recoverable existing branch */
          <div>
            <div
              style={{
                padding: "12px 16px",
                background: result ? "#f0fdf4" : "#eff6ff",
                borderRadius: 4,
                marginBottom: 12,
                fontSize: 13,
                color: result ? "#166534" : "#1d4ed8",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {result ? "コピー完了" : "既存のインポートブランチがあります"}
              </div>
              <div>ブランチ: {result?.branch_name ?? existingBranchName}</div>
              {result ? (
                <>
                  <div>{result.row_count.toLocaleString()}行</div>
                  <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                    共有カラム: {result.shared_columns.length}
                    {result.source_only_columns.length > 0 &&
                      ` / コピー元のみ: ${result.source_only_columns.length}`}
                    {result.dest_only_columns.length > 0 &&
                      ` / 宛先のみ: ${result.dest_only_columns.length}`}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  同じコピー元に対応する作業ブランチが既にあります。既存 branch を開いて続行してください。
                </div>
              )}
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
                disabled={switchingBranch}
                style={{ padding: "6px 16px", fontSize: 13 }}
              >
                {switchingBranch
                  ? "接続反映待ち..."
                  : result
                    ? "宛先に切り替え"
                    : "既存ブランチを開く"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
