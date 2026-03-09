import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import * as api from "../../api/client";
import { ApiError } from "../../api/errors";
import type { Database, Branch, CrossCopyTableResponse } from "../../types/api";

interface CrossCopyTableModalProps {
  tableName: string;
  onClose: () => void;
}

export function CrossCopyTableModal({
  tableName,
  onClose,
}: CrossCopyTableModalProps) {
  const { targetId, dbName } = useContextStore();

  const [databases, setDatabases] = useState<Database[]>([]);
  const [sourceBranches, setSourceBranches] = useState<Branch[]>([]);
  const [sourceBranch, setSourceBranch] = useState("main");
  const [destDB, setDestDB] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CrossCopyTableResponse | null>(null);

  // Load source branches on mount
  useEffect(() => {
    api
      .getBranches(targetId, dbName)
      .then((brs) => {
        const sorted = [...brs].sort((a, b) => {
          const aProtected = a.name === "main" || a.name === "audit";
          const bProtected = b.name === "main" || b.name === "audit";
          if (aProtected && !bProtected) return -1;
          if (!aProtected && bProtected) return 1;
          return a.name.localeCompare(b.name);
        });
        setSourceBranches(sorted);
        const hasMain = sorted.some((b) => b.name === "main");
        if (!hasMain && sorted.length > 0) setSourceBranch(sorted[0].name);
      })
      .catch(() => {});
  }, [targetId, dbName]);

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
    try {
      const res = await api.crossCopyTable({
        target_id: targetId,
        source_db: dbName,
        source_branch: sourceBranch,
        source_table: tableName,
        dest_db: destDB,
      });
      setResult(res);
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError ? err.message : "テーブルコピーに失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchContext = () => {
    if (!result) return;
    if (useDraftStore.getState().hasDraft()) {
      if (!window.confirm("未保存の変更があります。破棄して切り替えますか？")) return;
    }
    const ctx = useContextStore.getState();
    ctx.setDatabase(destDB);
    // Branch is verified queryable by backend before returning, so direct switch is safe.
    ctx.setBranch(result.branch_name);
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

        {!result ? (
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
                コピー元ブランチ
              </label>
              <select
                value={sourceBranch}
                onChange={(e) => setSourceBranch(e.target.value)}
                style={{ width: "100%", padding: "4px 8px", fontSize: 13 }}
              >
                {sourceBranches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

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
          /* Result */
          <div>
            <div
              style={{
                padding: "12px 16px",
                background: "#f0fdf4",
                borderRadius: 4,
                marginBottom: 12,
                fontSize: 13,
                color: "#166534",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                コピー完了
              </div>
              <div>ブランチ: {result.branch_name}</div>
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
                onClick={handleSwitchContext}
                style={{ padding: "6px 16px", fontSize: 13 }}
              >
                宛先に切り替え
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
