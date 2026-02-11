import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";
import type { DiffRow } from "../../types/api";

interface DiffViewerProps {
  tableName: string;
  fromRef: string;
  toRef: string;
}

export function DiffViewer({ tableName, fromRef, toRef }: DiffViewerProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tableName || !fromRef || !toRef) return;
    setLoading(true);
    setError(null);
    api
      .getDiffTable(targetId, dbName, branchName, tableName, fromRef, toRef)
      .then((res) => setRows(res.rows || []))
      .catch((err) => {
        const e = err as { error?: { message?: string } };
        setError(e?.error?.message || "Failed to load diff");
      })
      .finally(() => setLoading(false));
  }, [targetId, dbName, branchName, tableName, fromRef, toRef]);

  if (loading) {
    return <div style={{ padding: 24, textAlign: "center" }}>Loading diff...</div>;
  }

  if (error) {
    return <div className="error-banner">{error}</div>;
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#888" }}>
        No differences found.
      </div>
    );
  }

  // Get all column names from the first row
  const allCols = rows.length > 0
    ? Object.keys(rows[0].from || rows[0].to || {}).filter(
        (k) => k !== "diff_type"
      )
    : [];

  return (
    <div style={{ padding: 16, overflow: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #d0d0d8" }}>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Type</th>
            {allCols.map((col) => (
              <th key={col} style={{ textAlign: "left", padding: "6px 8px" }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const bgColor =
              row.diff_type === "added"
                ? "#f0fdf4"
                : row.diff_type === "removed"
                ? "#fef2f2"
                : "#fffbeb";
            return (
              <tr
                key={i}
                style={{
                  borderBottom: "1px solid #e8e8f0",
                  background: bgColor,
                }}
              >
                <td style={{ padding: "6px 8px" }}>
                  <span
                    className={`badge ${
                      row.diff_type === "added"
                        ? "badge-success"
                        : row.diff_type === "removed"
                        ? "badge-danger"
                        : "badge-warning"
                    }`}
                  >
                    {row.diff_type}
                  </span>
                </td>
                {allCols.map((col) => {
                  const val = (row.to || row.from || {})[col];
                  return (
                    <td
                      key={col}
                      style={{
                        padding: "6px 8px",
                        fontFamily: "monospace",
                        fontSize: 12,
                      }}
                    >
                      {val != null ? String(val) : ""}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
