import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";
import type { HistoryCommit, DiffSummaryEntry } from "../../types/api";

// --- Diff Summary Panel ---
function DiffSummaryPanel({ targetId, dbName, branchName }: {
  targetId: string;
  dbName: string;
  branchName: string;
}) {
  const [entries, setEntries] = useState<DiffSummaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (branchName === "main") {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api.getDiffSummary(targetId, dbName, branchName)
      .then((res) => setEntries(res.entries || []))
      .catch((err) => {
        const e = err as { error?: { message?: string } };
        setError(e?.error?.message || "Failed to load diff summary");
      })
      .finally(() => setLoading(false));
  }, [targetId, dbName, branchName]);

  if (branchName === "main") {
    return (
      <div style={{ fontSize: 12, color: "#888", padding: 8 }}>
        main branch — no branch diff available.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 }}>
        Changes introduced by <code style={{ fontSize: 11 }}>{branchName}</code> vs main (3-way):
      </div>
      {loading && <div style={{ fontSize: 12, color: "#888" }}>Loading...</div>}
      {error && <div style={{ fontSize: 12, color: "#991b1b" }}>⚠ {error}</div>}
      {!loading && !error && entries.length === 0 && (
        <div style={{ fontSize: 12, color: "#888" }}>No changes detected vs main.</div>
      )}
      {!loading && entries.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #d0d0d8", color: "#666" }}>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Table</th>
              <th style={{ textAlign: "right", padding: "4px 8px", color: "#065f46" }}>+Added</th>
              <th style={{ textAlign: "right", padding: "4px 8px", color: "#92400e" }}>~Modified</th>
              <th style={{ textAlign: "right", padding: "4px 8px", color: "#991b1b" }}>−Removed</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.table} style={{ borderBottom: "1px solid #f0f0f5" }}>
                <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{e.table}</td>
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
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// --- Commit Log Panel ---
function CommitLog({ targetId, dbName, branchName }: {
  targetId: string;
  dbName: string;
  branchName: string;
}) {
  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;

  useEffect(() => {
    setPage(1);
  }, [targetId, dbName, branchName]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getHistoryCommits(targetId, dbName, branchName, page, pageSize)
      .then((data) => setCommits(data || []))
      .catch((err) => {
        const e = err as { error?: { message?: string } };
        setError(e?.error?.message || "Failed to load history");
      })
      .finally(() => setLoading(false));
  }, [targetId, dbName, branchName, page]);

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 }}>
        Commit log — <code style={{ fontSize: 11 }}>{branchName}</code>
      </div>
      {loading && <div style={{ fontSize: 12, color: "#888" }}>Loading...</div>}
      {error && <div style={{ fontSize: 12, color: "#991b1b" }}>⚠ {error}</div>}
      {!loading && !error && commits.length === 0 && (
        <div style={{ fontSize: 12, color: "#888" }}>No commits found.</div>
      )}
      {commits.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #d0d0d8", color: "#666" }}>
              <th style={{ textAlign: "left", padding: "4px 8px", width: 90 }}>Hash</th>
              <th style={{ textAlign: "left", padding: "4px 8px", width: 120 }}>Date</th>
              <th style={{ textAlign: "left", padding: "4px 8px", width: 100 }}>Author</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Message</th>
            </tr>
          </thead>
          <tbody>
            {commits.map((c) => (
              <tr key={c.hash} style={{ borderBottom: "1px solid #f0f0f5" }}>
                <td style={{ padding: "4px 8px", fontFamily: "monospace", color: "#4361ee" }}>
                  {c.hash.substring(0, 8)}
                </td>
                <td style={{ padding: "4px 8px", color: "#666" }}>
                  {c.timestamp ? c.timestamp.substring(0, 16).replace("T", " ") : "—"}
                </td>
                <td style={{ padding: "4px 8px", color: "#555" }}>{c.author}</td>
                <td style={{ padding: "4px 8px" }}>{c.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/* Pagination */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, justifyContent: "center" }}>
        <button
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => p - 1)}
          style={{ fontSize: 12, padding: "3px 10px" }}
        >
          ◀ Prev
        </button>
        <span style={{ fontSize: 12, color: "#666" }}>Page {page}</span>
        <button
          disabled={commits.length < pageSize || loading}
          onClick={() => setPage((p) => p + 1)}
          style={{ fontSize: 12, padding: "3px 10px" }}
        >
          Next ▶
        </button>
      </div>
    </div>
  );
}

// --- History Tab (top-level) ---
export function HistoryTab() {
  const { targetId, dbName, branchName } = useContextStore();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%", overflow: "auto" }}>
      {/* Top: Diff summary vs main */}
      <div
        style={{
          padding: 16,
          background: "#f8fafc",
          borderBottom: "1px solid #d0d0d8",
          flexShrink: 0,
        }}
      >
        <DiffSummaryPanel targetId={targetId} dbName={dbName} branchName={branchName} />
      </div>

      {/* Bottom: Commit log */}
      <div style={{ padding: 16, flex: 1 }}>
        <CommitLog targetId={targetId} dbName={dbName} branchName={branchName} />
      </div>
    </div>
  );
}
