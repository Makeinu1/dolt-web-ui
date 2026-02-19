import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";

// Columns injected by dolt_history_<table> — exclude from data display
const META_COLS = new Set(["commit_hash", "commit_date", "committer"]);

function formatDate(val: unknown): string {
  if (!val) return "-";
  const s = String(val);
  // Dolt returns "2006-01-02 15:04:05.999" or ISO 8601
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface Props {
  table: string;
  pkJson: string;   // JSON string: {"Primary":42}
  pkLabel: string;  // display label: "42"
  onClose: () => void;
}

export function RecordHistoryPopup({ table, pkJson, pkLabel, onClose }: Props) {
  const { targetId, dbName, branchName } = useContextStore();
  const [snapshots, setSnapshots] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getHistoryRow(targetId, dbName, branchName, table, pkJson, 30)
      .then((rows) => setSnapshots(rows || []))
      .catch((err: unknown) => {
        const e = err as { error?: { message?: string } };
        setError(e?.error?.message || "Failed to load history");
      })
      .finally(() => setLoading(false));
  }, [targetId, dbName, branchName, table, pkJson]);

  // Data columns = all columns except meta
  const dataCols = snapshots.length > 0
    ? Object.keys(snapshots[0]).filter((k) => !META_COLS.has(k))
    : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ minWidth: 560, maxWidth: 800, maxHeight: "82vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Record History</h2>
          <span style={{ fontSize: 13, color: "#555" }}>
            <code>{table}</code> [PK = <code>{pkLabel}</code>]
          </span>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", fontSize: 12 }}
          >
            Close
          </button>
        </div>

        {loading && (
          <div style={{ textAlign: "center", color: "#888", padding: 24 }}>
            Loading history...
          </div>
        )}
        {error && (
          <div style={{ color: "#991b1b", fontSize: 13 }}>{error}</div>
        )}

        {!loading && !error && snapshots.length === 0 && (
          <div style={{ textAlign: "center", color: "#888", padding: 24 }}>
            No history found.
          </div>
        )}

        {!loading && !error && snapshots.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {snapshots.map((snap, idx) => {
              const prev = snapshots[idx + 1]; // older snapshot (next in array = older, because desc order)
              const changedCols = new Set<string>();
              if (prev) {
                for (const col of dataCols) {
                  if (String(snap[col]) !== String(prev[col])) {
                    changedCols.add(col);
                  }
                }
              }

              const isLatest = idx === 0;

              return (
                <div
                  key={String(snap["commit_hash"]) + idx}
                  style={{
                    border: "1px solid #e0e0e8",
                    borderRadius: 6,
                    overflow: "hidden",
                    background: isLatest ? "#f8faff" : "#fff",
                  }}
                >
                  {/* Snapshot header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      background: isLatest ? "#dbeafe" : "#f0f0f8",
                      borderBottom: "1px solid #e0e0e8",
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: "#1d4ed8", fontWeight: 600 }}>●</span>
                    <span style={{ fontWeight: 600, color: "#1e293b" }}>
                      {formatDate(snap["commit_date"])}
                    </span>
                    <span style={{ color: "#64748b" }}>by</span>
                    <span style={{ fontFamily: "monospace", color: "#334155" }}>
                      {String(snap["committer"] ?? "-")}
                    </span>
                    {isLatest && (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 10,
                          background: "#1d4ed8",
                          color: "#fff",
                          borderRadius: 4,
                          padding: "1px 6px",
                        }}
                      >
                        latest
                      </span>
                    )}
                    {idx === snapshots.length - 1 && !isLatest && (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 10,
                          background: "#6b7280",
                          color: "#fff",
                          borderRadius: 4,
                          padding: "1px 6px",
                        }}
                      >
                        oldest
                      </span>
                    )}
                  </div>

                  {/* Data table */}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#f8f8fc" }}>
                          {dataCols.map((col) => (
                            <th
                              key={col}
                              style={{
                                textAlign: "left",
                                padding: "4px 8px",
                                borderBottom: "1px solid #e0e0e8",
                                fontWeight: 600,
                                color: changedCols.has(col) ? "#92400e" : "#555",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {changedCols.has(col) ? `~ ${col}` : col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {dataCols.map((col) => {
                            const changed = changedCols.has(col);
                            const val = snap[col];
                            return (
                              <td
                                key={col}
                                style={{
                                  padding: "4px 8px",
                                  background: changed ? "#fef3c7" : "transparent",
                                  fontFamily: "monospace",
                                  fontSize: 12,
                                  borderBottom: "none",
                                  maxWidth: 200,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={String(val ?? "")}
                              >
                                {val == null ? (
                                  <span style={{ color: "#aaa", fontStyle: "italic" }}>null</span>
                                ) : (
                                  String(val)
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Changed cells summary */}
                  {changedCols.size > 0 && prev && (
                    <div
                      style={{
                        padding: "4px 10px",
                        background: "#fffbeb",
                        borderTop: "1px solid #fde68a",
                        fontSize: 11,
                        color: "#92400e",
                      }}
                    >
                      Changed:{" "}
                      {[...changedCols].map((col, i) => (
                        <span key={col}>
                          {i > 0 && ", "}
                          <strong>{col}</strong>{" "}
                          <span style={{ fontFamily: "monospace" }}>
                            "{String(prev[col] ?? "")}"
                          </span>{" "}
                          → {" "}
                          <span style={{ fontFamily: "monospace" }}>
                            "{String(snap[col] ?? "")}"
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                  {idx === snapshots.length - 1 && (
                    <div
                      style={{
                        padding: "4px 10px",
                        background: "#f0fdf4",
                        borderTop: "1px solid #bbf7d0",
                        fontSize: 11,
                        color: "#14532d",
                      }}
                    >
                      Record created
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
