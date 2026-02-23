import { useEffect, useRef, useState } from "react";
import * as api from "../../api/client";
import type { CellComment } from "../../types/api";

interface CellCommentPanelProps {
  targetId: string;
  dbName: string;
  branchName: string;
  table: string;
  pk: string;
  column: string;
  onClose: () => void;
  /** Called after a comment is added or deleted so the parent can refresh the comment map. */
  onChanged: () => void;
}

export function CellCommentPanel({
  targetId,
  dbName,
  branchName,
  table,
  pk,
  column,
  onClose,
  onChanged,
}: CellCommentPanelProps) {
  const [comments, setComments] = useState<CellComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const isMain = branchName === "main";

  const load = () => {
    setLoading(true);
    api
      .listComments(targetId, dbName, branchName, table, pk, column)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    textRef.current?.focus();
  }, [targetId, dbName, branchName, table, pk, column]);

  const handleAdd = async () => {
    if (!newText.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await api.addComment({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        table_name: table,
        pk_value: pk,
        column_name: column,
        comment_text: newText.trim(),
      });
      setNewText("");
      load();
      onChanged();
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "コメントの追加に失敗しました");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    setError(null);
    try {
      await api.deleteComment({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        comment_id: commentId,
      });
      load();
      onChanged();
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "コメントの削除に失敗しました");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      handleAdd();
    }
  };

  return (
    <div className="cell-comment-panel">
      {/* Header */}
      <div className="cell-comment-panel-header">
        <span className="cell-comment-panel-title">
          💬 {table} / {column}
          <span style={{ fontWeight: 400, color: "#888", fontSize: 11 }}>&nbsp;(pk={pk})</span>
        </span>
        <button className="cell-comment-close" onClick={onClose}>×</button>
      </div>

      {/* Comment list */}
      <div className="cell-comment-list">
        {loading ? (
          <div className="cell-comment-empty">読み込み中...</div>
        ) : comments.length === 0 ? (
          <div className="cell-comment-empty">コメントなし</div>
        ) : (
          comments.map((c) => (
            <div key={c.comment_id} className="cell-comment-item">
              <div className="cell-comment-meta">{c.created_at.replace("T", " ")}</div>
              <div className="cell-comment-text">{c.comment_text}</div>
              {!isMain && (
                <button
                  className="cell-comment-delete"
                  onClick={() => handleDelete(c.comment_id)}
                  title="削除"
                >
                  🗑
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Error */}
      {error && <div className="cell-comment-error">{error}</div>}

      {/* Add new comment (work branch only) */}
      {!isMain && (
        <div className="cell-comment-add">
          <textarea
            ref={textRef}
            className="cell-comment-textarea"
            placeholder="新しいコメント... (Ctrl+Enter で追加)"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={5000}
            rows={3}
          />
          <button
            className="cell-comment-add-btn"
            onClick={handleAdd}
            disabled={adding || !newText.trim()}
          >
            {adding ? "追加中..." : "追加"}
          </button>
        </div>
      )}
    </div>
  );
}
