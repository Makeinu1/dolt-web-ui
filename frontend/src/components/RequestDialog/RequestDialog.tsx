import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";
import type { RequestSummary, DiffSummaryEntry } from "../../types/api";

// --- Diff summary for Submit preview (single DiffSummary API call) ---
function SubmitDiffSummary({ targetId, dbName, branchName }: {
  targetId: string;
  dbName: string;
  branchName: string;
}) {
  const [summaries, setSummaries] = useState<DiffSummaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.getDiffSummary(targetId, dbName, branchName)
      .then((res) => {
        if (!cancelled) setSummaries(res.entries || []);
      })
      .catch((err) => {
        const e = err as { error?: { message?: string } };
        if (!cancelled) setError(e?.error?.message || "Failed to load diff");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [targetId, dbName, branchName]);

  if (loading) {
    return <div style={{ fontSize: 12, color: "#888", padding: "8px 0" }}>Loading diff summary...</div>;
  }
  if (error) {
    return <div style={{ fontSize: 12, color: "#991b1b" }}>⚠ {error}</div>;
  }
  if (summaries.length === 0) {
    return <div style={{ fontSize: 12, color: "#888" }}>No changes detected on this branch vs main.</div>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid #e0e0e8", color: "#666" }}>
          <th style={{ textAlign: "left", padding: "4px 8px" }}>Table</th>
          <th style={{ textAlign: "right", padding: "4px 8px", color: "#065f46" }}>+Added</th>
          <th style={{ textAlign: "right", padding: "4px 8px", color: "#92400e" }}>~Modified</th>
          <th style={{ textAlign: "right", padding: "4px 8px", color: "#991b1b" }}>−Removed</th>
        </tr>
      </thead>
      <tbody>
        {summaries.map((s) => (
          <tr key={s.table} style={{ borderBottom: "1px solid #f0f0f5" }}>
            <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{s.table}</td>
            <td style={{ textAlign: "right", padding: "4px 8px", color: "#065f46" }}>
              {s.added > 0 ? `+${s.added}` : ""}
            </td>
            <td style={{ textAlign: "right", padding: "4px 8px", color: "#92400e" }}>
              {s.modified > 0 ? `~${s.modified}` : ""}
            </td>
            <td style={{ textAlign: "right", padding: "4px 8px", color: "#991b1b" }}>
              {s.removed > 0 ? `−${s.removed}` : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface SubmitDialogProps {
  expectedHead: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export function SubmitDialog({
  expectedHead,
  onClose,
  onSubmitted,
}: SubmitDialogProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const [submitting, setSubmitting] = useState(false);
  const [summaryJa, setSummaryJa] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!summaryJa.trim()) {
      setError("変更概要を入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.submitRequest({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        expected_head: expectedHead,
        summary_ja: summaryJa,
      });
      onSubmitted();
      onClose();
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <h2>Submit for Approval</h2>
        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

        {/* Three-dot diff summary */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#555" }}>
            Changes introduced by <code>{branchName}</code> vs main:
          </div>
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 4,
              padding: 8,
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            <SubmitDiffSummary
              targetId={targetId}
              dbName={dbName}
              branchName={branchName}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
            変更概要 (summary_ja) *
          </label>
          <textarea
            value={summaryJa}
            onChange={(e) => setSummaryJa(e.target.value)}
            rows={3}
            style={{ width: "100%", fontSize: 13 }}
            placeholder="この変更の概要を記入してください"
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
          <button className="primary" onClick={handleSubmit} disabled={submitting || !summaryJa.trim()}>
            {submitting ? "Submitting..." : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Approve confirmation modal ---
function ApproveModal({
  requestId,
  workBranch,
  onClose,
  onApproved,
}: {
  requestId: string;
  workBranch: string;
  onClose: () => void;
  onApproved: () => void;
}) {
  const { targetId, dbName, setBranch } = useContextStore();
  const [mergeMessage, setMergeMessage] = useState(`承認マージ: ${requestId}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.approveRequest({
        target_id: targetId,
        db_name: dbName,
        request_id: requestId,
        merge_message_ja: mergeMessage,
      });

      // Auto-switch to next round branch if created
      if (response.next_branch) {
        setBranch(response.next_branch);
      }

      onApproved();
      onClose();
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "Approve failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <h2>Approve Request</h2>
        {error && <div className="error-banner">{error}</div>}
        <p style={{ fontSize: 13, marginBottom: 12 }}>
          Approve <strong>{requestId}</strong> and merge <code>{workBranch}</code> into main.
        </p>

        {/* Diff preview */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#555" }}>
            Changes introduced by <code>{workBranch}</code> vs main:
          </div>
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 4,
              padding: 8,
              maxHeight: 180,
              overflowY: "auto",
            }}
          >
            <SubmitDiffSummary
              targetId={targetId}
              dbName={dbName}
              branchName={workBranch}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
            承認コミットメッセージ
          </label>
          <textarea
            value={mergeMessage}
            onChange={(e) => setMergeMessage(e.target.value)}
            rows={2}
            style={{ width: "100%", fontSize: 13 }}
          />
        </div>
        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          <button
            className="primary"
            onClick={handleApprove}
            disabled={loading || !mergeMessage.trim()}
            style={{ background: "#065f46", borderColor: "#065f46" }}
          >
            {loading ? "Approving..." : "Approve & Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Reject confirmation modal ---
function RejectModal({
  requestId,
  onClose,
  onRejected,
}: {
  requestId: string;
  onClose: () => void;
  onRejected: () => void;
}) {
  const { targetId, dbName } = useContextStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReject = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.rejectRequest({
        target_id: targetId,
        db_name: dbName,
        request_id: requestId,
      });
      onRejected();
      onClose();
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "Reject failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reject Request</h2>
        {error && <div className="error-banner">{error}</div>}
        <p style={{ fontSize: 13, marginBottom: 16 }}>
          Reject <strong>{requestId}</strong>? The request tag will be deleted.
          The work branch is preserved for re-submission.
        </p>
        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          <button
            className="danger"
            onClick={handleReject}
            disabled={loading}
          >
            {loading ? "Rejecting..." : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Approver inbox view ---
export function ApproverInbox() {
  const { targetId, dbName, triggerBranchRefresh } = useContextStore();
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [approveTarget, setApproveTarget] = useState<string | null>(null);
  const [approveWorkBranch, setApproveWorkBranch] = useState<string>("");
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!targetId || !dbName) return;
    setLoading(true);
    api
      .listRequests(targetId, dbName)
      .then((data) => setRequests(data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [targetId, dbName]);

  const onApproved = () => {
    if (approveTarget) {
      setRequests((prev) => prev.filter((r) => r.request_id !== approveTarget));
    }
    triggerBranchRefresh();
  };

  const onRejected = () => {
    if (rejectTarget) {
      setRequests((prev) => prev.filter((r) => r.request_id !== rejectTarget));
    }
    triggerBranchRefresh();
  };

  if (loading) {
    return <div style={{ padding: 24, textAlign: "center" }}>Loading requests...</div>;
  }

  if (requests.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#888" }}>
        No pending requests.
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
        Pending Approval Requests
      </h3>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #d0d0d8" }}>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Request ID</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Work Branch</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>概要</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Submitted</th>
            <th style={{ textAlign: "right", padding: "6px 8px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr
              key={r.request_id}
              style={{ borderBottom: "1px solid #e8e8f0" }}
            >
              <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: 12 }}>
                {r.request_id}
              </td>
              <td style={{ padding: "6px 8px" }}>{r.work_branch}</td>
              <td style={{ padding: "6px 8px", fontSize: 12 }}>{r.summary_ja || "-"}</td>
              <td style={{ padding: "6px 8px", fontSize: 12, color: "#666" }}>
                {r.submitted_at || "-"}
              </td>
              <td style={{ textAlign: "right", padding: "6px 8px" }}>
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <button
                    className="success"
                    onClick={() => {
                      setApproveTarget(r.request_id);
                      setApproveWorkBranch(r.work_branch);
                    }}
                    style={{ fontSize: 11 }}
                  >
                    Approve
                  </button>
                  <button
                    className="danger"
                    onClick={() => setRejectTarget(r.request_id)}
                    style={{ fontSize: 11 }}
                  >
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {approveTarget && (
        <ApproveModal
          requestId={approveTarget}
          workBranch={approveWorkBranch}
          onClose={() => setApproveTarget(null)}
          onApproved={onApproved}
        />
      )}
      {rejectTarget && (
        <RejectModal
          requestId={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={onRejected}
        />
      )}
    </div>
  );
}
