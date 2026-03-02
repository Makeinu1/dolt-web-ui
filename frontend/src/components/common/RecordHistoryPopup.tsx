import { useEffect, useState } from "react";
import * as api from "../../api/client";
import type { HistoryRowSnapshot } from "../../types/api";

interface RecordHistoryPopupProps {
  targetId: string;
  dbName: string;
  branchName: string;
  table: string;
  pk: string; // JSON-encoded PK map
  onClose: () => void;
}

export function RecordHistoryPopup({
  targetId,
  dbName,
  branchName,
  table,
  pk,
  onClose,
}: RecordHistoryPopupProps) {
  const [snapshots, setSnapshots] = useState<HistoryRowSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getHistoryRow(targetId, dbName, branchName, table, pk)
      .then((res) => setSnapshots(res.snapshots || []))
      .catch((err) => {
        const e = err as { message?: string };
        setError(e?.message || "履歴の読み込みに失敗しました");
      })
      .finally(() => setLoading(false));
  }, [targetId, dbName, branchName, table, pk]);

  // Collect all data column names (excluding metadata)
  const dataCols = snapshots.length > 0 ? Object.keys(snapshots[0].row) : [];

  // Compute which columns changed between consecutive snapshots
  function changedCols(curr: HistoryRowSnapshot, prev: HistoryRowSnapshot | undefined): Set<string> {
    if (!prev) return new Set();
    return new Set(
      dataCols.filter((c) => String(curr.row[c] ?? "") !== String(prev.row[c] ?? ""))
    );
  }

  function formatDate(dateStr: string): string {
    try {
      return new Date(dateStr).toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{ zIndex: 300 }}
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 700, width: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>行の変更履歴 — {table}</h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "#666" }}
          >
            ✕
          </button>
        </div>

        <div style={{ fontSize: 11, color: "#888", marginBottom: 8, fontFamily: "monospace" }}>
          PK: {pk}
        </div>

        {loading && (
          <div style={{ fontSize: 13, color: "#888", padding: 16, textAlign: "center" }}>読み込み中...</div>
        )}

        {error && (
          <div style={{ fontSize: 12, color: "#991b1b", padding: "8px 0" }}>⚠ {error}</div>
        )}

        {!loading && !error && snapshots.length === 0 && (
          <div style={{ fontSize: 13, color: "#888", padding: 16, textAlign: "center" }}>
            履歴が見つかりません。
          </div>
        )}

        {!loading && snapshots.length > 0 && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {snapshots.map((snap, idx) => {
              // prev is the *older* snapshot (next index = older)
              const prev = snapshots[idx + 1];
              const changed = changedCols(snap, prev);
              const isLatest = idx === 0;

              return (
                <div
                  key={snap.commit_hash}
                  style={{
                    marginBottom: 12,
                    border: "1px solid #e0e0e8",
                    borderRadius: 6,
                    overflow: "hidden",
                  }}
                >
                  {/* Commit metadata header */}
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 10px",
                    background: isLatest ? "#e0e7ff" : "#f8f8fa",
                    borderBottom: "1px solid #e0e0e8",
                  }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      {isLatest && (
                        <span style={{ fontSize: 10, background: "#4361ee", color: "#fff", borderRadius: 3, padding: "1px 5px" }}>最新</span>
                      )}
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#333" }}>
                        {formatDate(snap.commit_date)}
                      </span>
                      <span style={{ fontSize: 11, color: "#555" }}>{snap.committer}</span>
                    </div>
                    <span style={{ fontSize: 10, color: "#999", fontFamily: "monospace" }}>
                      {snap.commit_hash.slice(0, 8)}
                    </span>
                  </div>

                  {/* Row data */}
                  <div style={{ padding: "6px 10px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <tbody>
                        {dataCols.map((col) => {
                          const isChanged = changed.has(col);
                          const val = snap.row[col];
                          const prevVal = prev?.row[col];
                          return (
                            <tr
                              key={col}
                              style={{ borderBottom: "1px solid #f0f0f5", background: isChanged ? "#fef3c7" : undefined }}
                            >
                              <td style={{ padding: "2px 8px", color: "#666", fontWeight: 600, minWidth: 120, verticalAlign: "top" }}>
                                {col}
                              </td>
                              <td style={{ padding: "2px 8px", fontFamily: "monospace", wordBreak: "break-all" }}>
                                {val != null ? String(val) : <span style={{ color: "#ccc" }}>NULL</span>}
                                {isChanged && prev && (
                                  <span style={{ marginLeft: 6, fontSize: 10, color: "#92400e" }}>
                                    (旧: {prevVal != null ? String(prevVal) : "NULL"})
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
