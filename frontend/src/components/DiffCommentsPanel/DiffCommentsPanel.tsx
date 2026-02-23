import { useEffect, useState } from "react";
import * as api from "../../api/client";
import type { CellComment } from "../../types/api";

interface DiffCommentsPanelProps {
  table: string;
  targetId: string;
  dbName: string;
  branchName: string;
  fromRef?: string;
  toRef?: string;
}

/**
 * DiffCommentsPanel — read-only view of comments for changed rows in a diff.
 * Fetches diff rows to get PKs, then batch-fetches comments for those PKs.
 * Displayed below DiffTableDetail in HistoryTab and RequestDialog.
 */
export function DiffCommentsPanel({
  table,
  targetId,
  dbName,
  branchName,
  fromRef,
  toRef,
}: DiffCommentsPanelProps) {
  const [comments, setComments] = useState<CellComment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!table || !targetId || !dbName || !branchName) return;

    const from = fromRef || "main";
    const to = toRef || branchName;
    let cancelled = false;

    setLoading(true);

    // Step 1: Fetch diff to get changed PKs
    api
      .getDiffTable(targetId, dbName, branchName, table, from, to, "three_dot", false, "", 1, 500)
      .then((diffResp) => {
        if (cancelled) return;

        // Collect unique PK values from changed rows
        const pkSet = new Set<string>();
        for (const row of diffResp.rows) {
          const src = row.from || row.to;
          if (src) {
            // Take the first key's value as PK (simplified single-PK assumption)
            const firstVal = Object.values(src)[0];
            if (firstVal != null) pkSet.add(String(firstVal));
          }
        }

        if (pkSet.size === 0) {
          setComments([]);
          setLoading(false);
          return;
        }

        // Step 2: Batch-fetch comments for those PKs
        return api
          .listCommentsForPks(targetId, dbName, branchName, table, Array.from(pkSet))
          .then((result) => {
            if (!cancelled) setComments(result);
          });
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [table, targetId, dbName, branchName, fromRef, toRef]);

  // Group comments by "pk:column"
  const grouped = new Map<string, CellComment[]>();
  for (const c of comments) {
    const key = `${c.pk_value}:${c.column_name}`;
    const list = grouped.get(key) ?? [];
    list.push(c);
    grouped.set(key, list);
  }

  if (loading) {
    return (
      <div style={{ fontSize: 11, color: "#888", padding: "4px 8px" }}>
        コメント読み込み中...
      </div>
    );
  }

  if (grouped.size === 0) return null;

  return (
    <div className="diff-comments-panel">
      <div className="diff-comments-panel-title">変更セルのコメント</div>
      {Array.from(grouped.entries()).map(([key, items]) => {
        const [pk, col] = key.split(":", 2);
        return (
          <div key={key} className="diff-comments-group">
            <div className="diff-comments-group-header">
              <span className="diff-comments-pk">pk={pk}</span>
              <span className="diff-comments-col">{col}</span>
            </div>
            {items.map((c) => (
              <div key={c.comment_id} className="diff-comments-item">
                <span className="diff-comments-date">
                  {c.created_at.replace("T", " ").slice(0, 16)}
                </span>
                <span className="diff-comments-text">{c.comment_text}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
