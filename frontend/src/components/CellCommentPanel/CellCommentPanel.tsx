import { useEffect, useRef, useState } from "react";
import * as api from "../../api/client";
import { useDraftStore } from "../../store/draft";

interface CellCommentPanelProps {
  targetId: string;
  dbName: string;
  branchName: string;
  table: string;
  pk: string;       // rowPkId JSON string (e.g. '{"id":1}')
  column: string;
  onClose: () => void;
}

export function CellCommentPanel({
  targetId,
  dbName,
  branchName,
  table,
  pk,
  column,
  onClose,
}: CellCommentPanelProps) {
  const ops = useDraftStore((s) => s.ops);
  const addOp = useDraftStore((s) => s.addOp);
  const removeOp = useDraftStore((s) => s.removeOp);

  const [dbMemoText, setDbMemoText] = useState("");
  const [loading, setLoading] = useState(true);
  const [memoText, setMemoText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const isProtected = branchName === "main" || branchName === "audit";
  const memoTable = `_memo_${table}`;

  // Find any pending draft op for this memo cell
  const existingOpIdx = ops.findIndex((o) => {
    if (o.table !== memoTable) return false;
    if (o.type === "insert") {
      return o.values?.pk_value === pk && o.values?.column_name === column;
    }
    return o.pk?.pk_value === pk && o.pk?.column_name === column;
  });
  const existingOp = existingOpIdx !== -1 ? ops[existingOpIdx] : null;

  // Whether the memo "effectively" exists (draft or DB)
  const effectiveHasMemo =
    existingOp !== null
      ? existingOp.type !== "delete"
      : dbMemoText !== "";

  useEffect(() => {
    setLoading(true);
    api
      .getMemo(targetId, dbName, branchName, table, pk, column)
      .then((res) => {
        setDbMemoText(res.memo_text);
        // Pre-fill textarea: use draft value if pending, else DB value
        if (existingOp && existingOp.type !== "delete") {
          setMemoText(String(existingOp.values?.memo_text ?? res.memo_text));
        } else if (existingOp?.type === "delete") {
          setMemoText("");
        } else {
          setMemoText(res.memo_text);
        }
      })
      .catch(() => {
        setDbMemoText("");
        setMemoText(existingOp && existingOp.type !== "delete"
          ? String(existingOp.values?.memo_text ?? "")
          : "");
      })
      .finally(() => {
        setLoading(false);
        textRef.current?.focus();
      });
  }, [targetId, dbName, branchName, table, pk, column]);

  const handleSave = () => {
    setError(null);

    // Remove any existing draft op for this memo cell
    if (existingOpIdx !== -1) removeOp(existingOpIdx);

    const text = memoText.trim();
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const memoPk = { pk_value: pk, column_name: column };

    if (!text) {
      // Clear memo
      if (effectiveHasMemo) {
        addOp({ type: "delete", table: memoTable, pk: memoPk, values: {} });
      }
    } else {
      // Set memo
      if (effectiveHasMemo) {
        addOp({
          type: "update",
          table: memoTable,
          pk: memoPk,
          values: { memo_text: text, updated_at: now },
        });
      } else {
        addOp({
          type: "insert",
          table: memoTable,
          values: { pk_value: pk, column_name: column, memo_text: text, updated_at: now },
        });
      }
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      handleSave();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="cell-comment-panel">
      {/* Header */}
      <div className="cell-comment-panel-header">
        <span className="cell-comment-panel-title">
          📝 {table} / {column}
          <span style={{ fontWeight: 400, color: "#888", fontSize: 11 }}>&nbsp;(pk={pk})</span>
        </span>
        <button className="cell-comment-close" onClick={onClose}>×</button>
      </div>

      {loading ? (
        <div className="cell-comment-empty">読み込み中...</div>
      ) : (
        <>
          {existingOp && (
            <div style={{ fontSize: 11, color: "#0369a1", background: "#e0f2fe", padding: "4px 10px", borderBottom: "1px solid #bae6fd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>✏ 未保存の変更あり</span>
              <button
                onClick={() => {
                  if (window.confirm("このセルのドラフト変更を破棄しますか？")) {
                    removeOp(existingOpIdx);
                    setMemoText(dbMemoText);
                  }
                }}
                style={{ fontSize: 10, padding: "1px 6px", background: "none", border: "1px solid #0369a1", color: "#0369a1", borderRadius: 3, cursor: "pointer" }}
              >
                破棄
              </button>
            </div>
          )}

          {/* Error */}
          {error && <div className="cell-comment-error">{error}</div>}

          {/* Memo edit area (work branch only) */}
          {!isProtected ? (
            <div className="cell-comment-add" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                ref={textRef}
                className="cell-comment-textarea"
                placeholder="メモを入力... (空欄で削除、Ctrl+Enter で保存)"
                value={memoText}
                onChange={(e) => setMemoText(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={5000}
                rows={5}
                style={{ flex: 1, resize: "vertical" }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={onClose}
                  style={{ fontSize: 12, padding: "4px 12px", background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer" }}
                >
                  キャンセル
                </button>
                <button
                  className="cell-comment-add-btn"
                  onClick={handleSave}
                >
                  下書きに追加
                </button>
              </div>
            </div>
          ) : (
            /* Read-only view on main */
            <div className="cell-comment-list">
              {dbMemoText ? (
                <div className="cell-comment-item">
                  <div className="cell-comment-text">{dbMemoText}</div>
                </div>
              ) : (
                <div className="cell-comment-empty">メモなし</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
