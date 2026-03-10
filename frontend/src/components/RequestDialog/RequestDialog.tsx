import React, { useCallback, useEffect, useRef, useState } from "react";
import { useContextStore } from "../../store/context";
import { DiffTableDetail } from "../common/DiffTableDetail";
import * as api from "../../api/client";
import { ApiError } from "../../api/errors";
import type { RequestSummary, DiffSummaryEntry, OverwrittenTable } from "../../types/api";

const DIFF_PREVIEW_TIMEOUT_MS = 3000;

// --- Expandable Diff summary (click table → cell-level detail) ---
function ExpandableDiffSummary({ targetId, dbName, branchName }: {
  targetId: string;
  dbName: string;
  branchName: string;
}) {
  const [entries, setEntries] = useState<DiffSummaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadSummary = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let timeoutId: ReturnType<typeof window.setTimeout> | undefined;

    setLoading(true);
    setError(null);
    setEntries([]);

    try {
      const res = await Promise.race([
        api.getDiffSummary(targetId, dbName, branchName),
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new ApiError(408, { code: "TIMEOUT", message: "差分の読み込みがタイムアウトしました。再試行してください。" }));
          }, DIFF_PREVIEW_TIMEOUT_MS);
        }),
      ]);

      if (requestIdRef.current !== requestId) return;
      setEntries(res.entries || []);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      const msg = err instanceof ApiError ? err.message : "差分の読み込みに失敗しました";
      setError(msg);
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [targetId, dbName, branchName]);

  useEffect(() => {
    void loadSummary();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadSummary]);

  const handleRetry = () => {
    void loadSummary();
  };

  if (loading) return <div style={{ fontSize: 12, color: "#888", padding: 8 }}>差分を読み込み中...</div>;
  if (error) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 12, color: "#991b1b" }}>⚠ {error}</div>
        <button
          onClick={handleRetry}
          style={{ fontSize: 11, padding: "2px 8px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer", color: "#334155", flexShrink: 0 }}
        >
          再試行
        </button>
      </div>
    );
  }
  if (entries.length === 0) return <div style={{ fontSize: 12, color: "#888" }}>mainとの差分はありません。</div>;

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #e0e0e8", color: "#666" }}>
            <th style={{ textAlign: "left", padding: "4px 8px" }}>テーブル</th>
            <th style={{ textAlign: "right", padding: "4px 8px", color: "#065f46" }}>+追加</th>
            <th style={{ textAlign: "right", padding: "4px 8px", color: "#92400e" }}>~変更</th>
            <th style={{ textAlign: "right", padding: "4px 8px", color: "#991b1b" }}>−削除</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <React.Fragment key={e.table}>
              <tr
                key={e.table}
                style={{
                  borderBottom: "1px solid #f0f0f5",
                  cursor: "pointer",
                  background: expandedTable === e.table ? "#f0f0f5" : undefined,
                }}
                onClick={() => setExpandedTable(expandedTable === e.table ? null : e.table)}
                title="クリックでセルレベル差分を表示"
              >
                <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>
                  {expandedTable === e.table ? "▼ " : "▶ "}{e.table}
                </td>
                <td style={{ textAlign: "right", padding: "4px 8px", color: "#065f46", fontWeight: e.added > 0 ? 600 : 400 }}>
                  {e.added > 0 ? `+${e.added}` : "—"}
                </td>
                <td style={{ textAlign: "right", padding: "4px 8px", color: "#92400e", fontWeight: e.modified > 0 ? 600 : 400 }}>
                  {e.modified > 0 ? `~${e.modified}` : "—"}
                </td>
                <td style={{ textAlign: "right", padding: "4px 8px", color: "#991b1b", fontWeight: e.removed > 0 ? 600 : 400 }}>
                  {e.removed > 0 ? `−${e.removed}` : "—"}
                </td>
              </tr>
              {expandedTable === e.table && (
                <tr key={`${e.table}-detail`}>
                  <td colSpan={4} style={{ padding: 0, background: "#fafafa", borderBottom: "2px solid #e0e0e8" }}>
                    <div style={{ maxHeight: 400, overflowY: "auto", padding: "4px 0" }}>
                      <DiffTableDetail
                        table={e.table}
                        targetId={targetId}
                        dbName={dbName}
                        branchName={branchName}
                      />
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Submit Dialog ---
interface SubmitDialogProps {
  expectedHead: string;
  onClose: () => void;
  onSubmitted: (overwrittenTables?: OverwrittenTable[]) => void;
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
      const result = await api.submitRequest({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        expected_head: expectedHead,
        summary_ja: summaryJa,
      });
      onSubmitted(result.overwritten_tables);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "";
      setError("申請に失敗しました" + (msg ? ": " + msg : ""));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => {
      if (summaryJa.trim() && !window.confirm("入力中の内容が破棄されます。閉じますか？")) return;
      onClose();
    }}>
      <div className="modal" style={{ minWidth: 600, maxWidth: 800 }} onClick={(e) => e.stopPropagation()}>
        <h2>承認を申請</h2>
        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

        {/* Expandable diff summary (click table for cell-level detail) */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#555" }}>
            <code style={{ fontSize: 11 }}>{branchName}</code> のmainからの変更:
          </div>
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 4,
              padding: 8,
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            <ExpandableDiffSummary
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
        <div className="modal-actions">
          <button onClick={onClose} disabled={submitting}>
            キャンセル
          </button>
          <button className="primary" onClick={handleSubmit} disabled={submitting || !summaryJa.trim()}>
            {submitting ? "申請中..." : "申請する"}
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
  onApproved: (nextBranch: string) => void;
}) {
  const { targetId, dbName } = useContextStore();
  const [mergeMessage, setMergeMessage] = useState(`承認マージ: ${requestId}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.approveRequest({
        target_id: targetId,
        db_name: dbName,
        request_id: requestId,
        merge_message_ja: mergeMessage,
      });
      onApproved(result.next_branch || "");
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "";
      setError("承認に失敗しました" + (msg ? ": " + msg : ""));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => {
      const defaultMsg = `承認マージ: ${requestId}`;
      if (mergeMessage !== defaultMsg && mergeMessage.trim() && !window.confirm("入力中の内容が破棄されます。閉じますか？")) return;
      onClose();
    }}>
      <div className="modal" style={{ minWidth: 600, maxWidth: 800 }} onClick={(e) => e.stopPropagation()}>
        <h2>承認</h2>
        {error && <div className="error-banner">{error}</div>}
        <p style={{ fontSize: 13, marginBottom: 12 }}>
          <code>{workBranch}</code> をmainにマージします。
        </p>

        {/* Expandable diff preview */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#555" }}>
            <code style={{ fontSize: 11 }}>{workBranch}</code> のmainからの変更:
          </div>
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 4,
              padding: 8,
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            <ExpandableDiffSummary
              targetId={targetId}
              dbName={dbName}
              branchName={workBranch}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
            承認メッセージ
          </label>
          <textarea
            value={mergeMessage}
            onChange={(e) => setMergeMessage(e.target.value)}
            rows={2}
            style={{ width: "100%", fontSize: 13 }}
          />
        </div>
        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>キャンセル</button>
          <button
            className="primary"
            onClick={handleApprove}
            disabled={loading || !mergeMessage.trim()}
            style={{ background: "#065f46", borderColor: "#065f46" }}
          >
            {loading ? "承認中..." : "承認してマージ"}
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
      const msg = err instanceof ApiError ? err.message : "";
      setError("却下に失敗しました" + (msg ? ": " + msg : ""));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>却下</h2>
        {error && <div className="error-banner">{error}</div>}
        <p style={{ fontSize: 13, marginBottom: 16 }}>
          リクエストを却下しますか？ タグは削除されますが、ブランチは残ります。
        </p>
        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>キャンセル</button>
          <button
            className="danger"
            onClick={handleReject}
            disabled={loading}
          >
            {loading ? "却下中..." : "却下する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Approver inbox view ---
export function ApproverInbox() {
  const { targetId, dbName, triggerBranchRefresh, setBranch } = useContextStore();
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [approveTarget, setApproveTarget] = useState<string | null>(null);
  const [approveWorkBranch, setApproveWorkBranch] = useState<string>("");
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);

  // BUG-F: wrapped in useCallback so the function identity is stable and can be listed in deps.
  const loadRequests = useCallback(() => {
    if (!targetId || !dbName) return;
    setLoading(true);
    api
      .listRequests(targetId, dbName)
      .then((data) => setRequests(data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [targetId, dbName]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const onApproved = (nextBranch: string) => {
    if (approveTarget) {
      setRequests((prev) => prev.filter((r) => r.request_id !== approveTarget));
    }
    triggerBranchRefresh();
    // Navigate to the auto-created next round branch if available
    if (nextBranch) {
      setBranch(nextBranch);
    }
  };

  const onRejected = () => {
    if (rejectTarget) {
      setRequests((prev) => prev.filter((r) => r.request_id !== rejectTarget));
    }
    triggerBranchRefresh();
  };

  if (loading) {
    return <div style={{ padding: 24, textAlign: "center" }}>読み込み中...</div>;
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
          承認待ちリクエスト ({requests.length})
        </h3>
        <button onClick={loadRequests} style={{ fontSize: 11, padding: "3px 10px" }}>
          🔄 更新
        </button>
      </div>

      {requests.length === 0 ? (
        <div style={{ textAlign: "center", color: "#888", padding: 16 }}>
          承認待ちのリクエストはありません
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #d0d0d8" }}>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>ブランチ</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>概要</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>申請日時</th>
              <th style={{ textAlign: "right", padding: "6px 8px" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.request_id} style={{ borderBottom: "1px solid #e8e8f0" }}>
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
                      承認
                    </button>
                    <button
                      className="danger"
                      onClick={() => setRejectTarget(r.request_id)}
                      style={{ fontSize: 11 }}
                    >
                      却下
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
