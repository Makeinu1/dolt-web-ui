import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";
import type { RequestSummary } from "../../types/api";

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
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.submitRequest({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        expected_head: expectedHead,
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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Submit for Approval</h2>
        {error && <div className="error-banner">{error}</div>}
        <p style={{ fontSize: 13, marginBottom: 16 }}>
          Submit branch <strong>{branchName}</strong> for review and approval.
          The current HEAD hash will be frozen for the reviewer.
        </p>
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
          <button className="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Approver inbox view
export function ApproverInbox() {
  const { targetId, dbName } = useContextStore();
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!targetId || !dbName) return;
    setLoading(true);
    api
      .listRequests(targetId, dbName)
      .then(setRequests)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [targetId, dbName]);

  const handleApprove = async (requestId: string) => {
    if (!window.confirm(`Approve request ${requestId}?`)) return;
    try {
      await api.approveRequest({
        target_id: targetId,
        db_name: dbName,
        request_id: requestId,
      });
      setRequests((prev) => prev.filter((r) => r.request_id !== requestId));
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      alert(e?.error?.message || "Approve failed");
    }
  };

  const handleReject = async (requestId: string) => {
    if (!window.confirm(`Reject request ${requestId}?`)) return;
    try {
      await api.rejectRequest({
        target_id: targetId,
        db_name: dbName,
        request_id: requestId,
      });
      setRequests((prev) => prev.filter((r) => r.request_id !== requestId));
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      alert(e?.error?.message || "Reject failed");
    }
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
            <th style={{ textAlign: "left", padding: "6px 8px" }}>
              Request ID
            </th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>
              Work Branch
            </th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>
              Submitted
            </th>
            <th style={{ textAlign: "right", padding: "6px 8px" }}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr
              key={r.request_id}
              style={{ borderBottom: "1px solid #e8e8f0" }}
            >
              <td
                style={{
                  padding: "6px 8px",
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                {r.request_id}
              </td>
              <td style={{ padding: "6px 8px" }}>{r.work_branch}</td>
              <td style={{ padding: "6px 8px", fontSize: 12, color: "#666" }}>
                {r.submitted_at || "-"}
              </td>
              <td style={{ textAlign: "right", padding: "6px 8px" }}>
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <button
                    className="success"
                    onClick={() => handleApprove(r.request_id)}
                    style={{ fontSize: 11 }}
                  >
                    Approve
                  </button>
                  <button
                    className="danger"
                    onClick={() => handleReject(r.request_id)}
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
    </div>
  );
}
