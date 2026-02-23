import { useRef, useState } from "react";
import * as api from "../../api/client";
import type { CellComment } from "../../types/api";

interface CommentSearchModalProps {
  targetId: string;
  dbName: string;
  branchName: string;
  onClose: () => void;
  onNavigate: (table: string, pkValue: string) => void;
}

export function CommentSearchModal({
  targetId,
  dbName,
  branchName,
  onClose,
  onNavigate,
}: CommentSearchModalProps) {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<CellComment[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await api.searchComments(targetId, dbName, branchName, keyword.trim());
      setResults(res);
      setSearched(true);
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "検索に失敗しました");
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: 680, maxHeight: "80vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>コメント検索</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* Search bar */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            ref={inputRef}
            autoFocus
            className="modal-input"
            style={{ flex: 1 }}
            placeholder="キーワードを入力..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="btn-primary"
            onClick={handleSearch}
            disabled={searching || !keyword.trim()}
          >
            {searching ? "検索中..." : "検索"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ color: "#991b1b", fontSize: 12, marginBottom: 8 }}>{error}</div>
        )}

        {/* Results */}
        <div style={{ flex: 1, overflowY: "auto", fontSize: 12 }}>
          {searched && results.length === 0 && (
            <div style={{ color: "#888", padding: 16, textAlign: "center" }}>
              結果なし
            </div>
          )}
          {results.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e8e8f0", color: "#666", fontSize: 11 }}>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>テーブル</th>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>PK</th>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>カラム</th>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>コメント</th>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>日時</th>
                </tr>
              </thead>
              <tbody>
                {results.map((c) => (
                  <tr
                    key={c.comment_id}
                    style={{ borderBottom: "1px solid #f0f0f5", cursor: "pointer" }}
                    className="comment-search-row"
                    onClick={() => {
                      onNavigate(c.table_name, c.pk_value);
                      onClose();
                    }}
                  >
                    <td style={{ padding: "4px 8px", fontFamily: "monospace", color: "#3730a3" }}>
                      {c.table_name}
                    </td>
                    <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{c.pk_value}</td>
                    <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{c.column_name}</td>
                    <td style={{ padding: "4px 8px", maxWidth: 280 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.comment_text}
                      </div>
                    </td>
                    <td style={{ padding: "4px 8px", color: "#888", whiteSpace: "nowrap" }}>
                      {c.created_at.replace("T", " ").slice(0, 16)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
