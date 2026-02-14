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

export function CommitDialog({
  expectedHead,
  onClose,
  onCommitSuccess,
}: CommitDialogProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const { ops, clearDraft } = useDraftStore();
  const { setBaseState, setError } = useUIStore();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCommit = async () => {
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
        setError("HEAD has changed. Please refresh and try again.");
      } else {
        setBaseState("DraftEditing");
        setError(e?.error?.message || "Commit failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Commit Changes</h2>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
          {ops.length} operation(s) will be committed to branch{" "}
          <strong>{branchName}</strong>
        </p>
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              marginBottom: 4,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Commit Message (optional)
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
            placeholder="Leave empty for auto-generated message"
            autoFocus
          />
        </div>
        <div
          style={{
            background: "#f5f5f8",
            padding: 8,
            borderRadius: 4,
            fontSize: 11,
            color: "#666",
            marginBottom: 12,
          }}
        >
          HEAD: <code>{expectedHead.substring(0, 12)}</code>
        </div>
        <div className="modal-actions">
          <button onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={handleCommit}
            disabled={submitting}
          >
            {submitting ? "Committing..." : "Commit"}
          </button>
        </div>
      </div>
    </div>
  );
}
