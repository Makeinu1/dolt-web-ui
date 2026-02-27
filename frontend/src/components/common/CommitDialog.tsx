import { useState } from "react";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";
import { ApiError } from "../../api/errors";

interface CommitDialogProps {
  expectedHead: string;
  onClose: () => void;
  onCommitSuccess: (newHash: string) => void;
}

const OP_COLORS: Record<string, { bg: string; label: string; color: string }> = {
  insert: { bg: "#dcfce7", label: "+INSERT", color: "#16a34a" },
  update: { bg: "#fef3c7", label: "~UPDATE", color: "#92400e" },
  delete: { bg: "#fee2e2", label: "−DELETE", color: "#dc2626" },
};

export function CommitDialog({
  expectedHead,
  onClose,
  onCommitSuccess,
}: CommitDialogProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const { ops, clearDraft, removeOp } = useDraftStore();
  const { setBaseState, setError } = useUIStore();
  const [submitting, setSubmitting] = useState(false);

  const handleCommit = async () => {
    if (ops.length === 0) return;

    // Generate structured auto-commit message:
    // Single table: [{branch}] {table}テーブル: +{i} ~{u} -{d}
    // Multi table:  [{branch}] {N}テーブルの変更 (+{i} ~{u} -{d})
    const tableNames = Array.from(new Set(ops.map(op => op.table)));
    let ins = 0, upd = 0, del = 0;
    for (const op of ops) {
      if (op.type === "insert") ins++;
      else if (op.type === "update") upd++;
      else if (op.type === "delete") del++;
    }
    const counts = `+${ins} ~${upd} -${del}`;
    const commitMsg = tableNames.length === 1
      ? `[${branchName}] ${tableNames[0]}テーブル: ${counts}`
      : `[${branchName}] ${tableNames.length}テーブルの変更 (${counts})`;

    setSubmitting(true);
    setBaseState("Committing");

    try {
      const result = await api.commit({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        expected_head: expectedHead,
        commit_message: commitMsg,
        ops,
      });
      clearDraft();
      setBaseState("Idle");
      onCommitSuccess(result.hash);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === "STALE_HEAD") {
        setBaseState("StaleHeadDetected");
        setError("データが更新されています" + (err.message ? ": " + err.message : ""));
      } else {
        setBaseState("DraftEditing");
        const msg = err instanceof ApiError ? err.message : "";
        setError("保存に失敗しました" + (msg ? ": " + msg : ""));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveOp = (index: number) => {
    removeOp(index);
    if (ops.length <= 1) {
      // This was the last op
      setBaseState("Idle");
      onClose();
    }
  };

  // Group ops by table
  const grouped = ops.reduce<Record<string, { op: typeof ops[0]; index: number }[]>>((acc, op, i) => {
    if (!acc[op.table]) acc[op.table] = [];
    acc[op.table].push({ op, index: i });
    return acc;
  }, {});

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <h2>変更を保存</h2>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
          <strong>{branchName}</strong> ブランチへの {ops.length} 件の操作
        </p>

        {/* Change preview */}
        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 4,
            maxHeight: 240,
            overflowY: "auto",
            marginBottom: 12,
          }}
        >
          {Object.entries(grouped).map(([table, items]) => (
            <div key={table}>
              <div style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, color: "#555", borderBottom: "1px solid #e2e8f0", background: "#f1f5f9" }}>
                {table} ({items.length})
              </div>
              {items.map(({ op, index }) => {
                const style = OP_COLORS[op.type] || OP_COLORS.update;
                const pkText = op.pk ? Object.values(op.pk).join(",") : "";
                const valText = op.values
                  ? Object.entries(op.values)
                    .filter(([k]) => !op.pk || !(k in op.pk))
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")
                  : "";
                return (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "3px 10px",
                      fontSize: 11,
                      borderBottom: "1px solid #f0f0f5",
                      background: style.bg,
                    }}
                  >
                    <span style={{ fontWeight: 700, color: style.color, width: 70, flexShrink: 0 }}>
                      {style.label}
                    </span>
                    <span style={{ flex: 1, fontFamily: "monospace", fontSize: 10, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {pkText && <span style={{ color: "#666" }}>PK={pkText} </span>}
                      {valText}
                    </span>
                    <button
                      onClick={() => handleRemoveOp(index)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#991b1b",
                        cursor: "pointer",
                        fontSize: 13,
                        padding: "0 4px",
                        flexShrink: 0,
                      }}
                      title="この操作を取り消す"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button onClick={onClose} disabled={submitting}>
            キャンセル
          </button>
          <button
            className="primary"
            onClick={handleCommit}
            disabled={submitting || ops.length === 0}
          >
            {submitting ? "保存中..." : `保存 (${ops.length}件)`}
          </button>
        </div>
      </div>
    </div>
  );
}
