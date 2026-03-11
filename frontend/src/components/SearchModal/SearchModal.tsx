import { useRef, useState } from "react";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";
import { ApiError } from "../../api/errors";
import type { SearchResult } from "../../types/api";
import { readIntegrityMessage } from "../../utils/apiResult";

interface SearchModalProps {
  onClose: () => void;
  onNavigate: (table: string, pk: string) => void;
}

export function SearchModal({ onClose, onNavigate }: SearchModalProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const inputRef = useRef<HTMLInputElement>(null);

  const [keyword, setKeyword] = useState("");
  const [includeMemo, setIncludeMemo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searchedKeyword, setSearchedKeyword] = useState("");

  const handleSearch = async () => {
    const kw = keyword.trim();
    if (!kw) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.search(targetId, dbName, branchName, kw, includeMemo, 100);
      const integrityError = readIntegrityMessage(res, "検索結果の整合性を確認できませんでした");
      if (integrityError) {
        setResults(null);
        setError(integrityError);
        return;
      }
      setResults(res.results);
      setSearchedKeyword(kw);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "検索に失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleResultClick = (r: SearchResult) => {
    onNavigate(r.table, r.pk);
    onClose();
  };

  // Group results by table for display
  const grouped = results
    ? results.reduce((acc, r) => {
        if (!acc[r.table]) acc[r.table] = [];
        acc[r.table].push(r);
        return acc;
      }, {} as Record<string, SearchResult[]>)
    : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ minWidth: 560, maxWidth: 760, maxHeight: "85vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>🔍 全テーブル検索</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#666" }}>✕</button>
        </div>

        {/* Search input */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            ref={inputRef}
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="キーワードを入力..."
            style={{ flex: 1, fontSize: 14, padding: "6px 10px" }}
            autoFocus
          />
          <button
            className="primary"
            onClick={handleSearch}
            disabled={loading || keyword.trim() === ""}
            style={{ padding: "6px 16px", fontSize: 13, whiteSpace: "nowrap" }}
          >
            {loading ? "検索中..." : "検索"}
          </button>
        </div>

        {/* Memo checkbox */}
        <label style={{ fontSize: 12, color: "#555", marginBottom: 10, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={includeMemo}
            onChange={(e) => setIncludeMemo(e.target.checked)}
          />
          メモも検索する
        </label>

        {/* Error */}
        {error && (
          <div style={{ padding: "6px 10px", background: "#fee2e2", color: "#991b1b", fontSize: 12, borderRadius: 4, marginBottom: 8 }}>
            {error}
          </div>
        )}

        {/* Results */}
        {results !== null && (
          <div style={{ flex: 1, overflow: "auto" }}>
            {results.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32, color: "#888", fontSize: 13 }}>
                「{searchedKeyword}」に一致する結果は見つかりませんでした
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
                  {results.length}件 見つかりました（キーワード: 「{searchedKeyword}」）
                </div>
                {Object.entries(grouped!).map(([table, rows]) => (
                  <div key={table} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4, padding: "2px 0", borderBottom: "1px solid #e2e8f0" }}>
                      📋 {table} ({rows.length}件)
                    </div>
                    {rows.map((r, i) => (
                      <div
                        key={i}
                        onClick={() => handleResultClick(r)}
                        style={{
                          display: "flex",
                          gap: 8,
                          padding: "5px 8px",
                          fontSize: 12,
                          cursor: "pointer",
                          borderRadius: 4,
                          marginBottom: 2,
                          background: r.match_type === "memo" ? "#fef3c7" : "#f8fafc",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = r.match_type === "memo" ? "#fde68a" : "#e2e8f0")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = r.match_type === "memo" ? "#fef3c7" : "#f8fafc")}
                      >
                        <span style={{ color: "#94a3b8", minWidth: 60, fontSize: 11 }}>
                          {r.match_type === "memo" ? "💬 メモ" : "📄 値"}
                        </span>
                        <span style={{ color: "#64748b", minWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          PK: {r.pk}
                        </span>
                        <span style={{ color: "#334155", fontWeight: 600, minWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.column}
                        </span>
                        <span style={{ color: "#1e293b", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.value}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
