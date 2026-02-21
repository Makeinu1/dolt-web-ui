import { useState } from "react";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";

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
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCommit = async () => {
    if (ops.length === 0) return;
    const commitMsg = message.trim() || `auto commit (${ops.length} ops)`;
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
      const e = err as { error?: { code?: string; message?: string } };
      if (e?.error?.code === "STALE_HEAD") {
        setBaseState("StaleHeadDetected");
        setError("HEAD changed. Refresh and try again.");
      } else {
        setBaseState("DraftEditing");
        setError(e?.error?.message || "Commit failed");
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
        <h2>変更をコミット</h2>
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

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
            Commit Message (optional)
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            style={{ width: "100%", fontSize: 13 }}
            placeholder="Leave empty for auto-generated message"
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={handleCommit}
            disabled={submitting || ops.length === 0}
          >
            {submitting ? "Committing..." : `Commit (${ops.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
