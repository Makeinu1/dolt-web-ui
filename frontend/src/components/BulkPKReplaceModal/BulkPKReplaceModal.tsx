import { useState, useMemo } from "react";
import type { ColumnSchema } from "../../types/api";

interface BulkPKReplaceModalProps {
  pkCols: ColumnSchema[];
  /** Only the INSERT (draft) rows from the current selection */
  selectedInsertRows: Record<string, unknown>[];
  onApply: (pkColumn: string, search: string, replace: string) => void;
  onClose: () => void;
}

export function BulkPKReplaceModal({
  pkCols,
  selectedInsertRows,
  onApply,
  onClose,
}: BulkPKReplaceModalProps) {
  const [pkColumn, setPkColumn] = useState(pkCols[0]?.name ?? "");
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");

  const preview = useMemo(() => {
    if (!pkColumn || !search) return [];
    return selectedInsertRows.map((row) => {
      const oldVal = String(row[pkColumn] ?? "");
      const matches = oldVal.includes(search);
      const newVal = matches ? oldVal.replaceAll(search, replace) : oldVal;
      return { oldVal, newVal, matches };
    });
  }, [selectedInsertRows, pkColumn, search, replace]);

  const matchCount = preview.filter((p) => p.matches).length;

  const handleApply = () => {
    if (!pkColumn || !search || matchCount === 0) return;
    onApply(pkColumn, search, replace);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ minWidth: 560, maxWidth: 700 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>PK 一括置換</h2>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
          選択中の INSERT 行 ({selectedInsertRows.length} 件) の PK 値を一括置換します
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          {/* PK column selector — only shown for composite PK */}
          {pkCols.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, minWidth: 120 }}>
                対象 PK カラム
              </label>
              <select
                value={pkColumn}
                onChange={(e) => setPkColumn(e.target.value)}
                style={{
                  fontSize: 12,
                  padding: "3px 6px",
                  border: "1px solid #d1d5db",
                  borderRadius: 4,
                }}
              >
                {pkCols.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, minWidth: 120 }}>
              検索文字列
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="例: _2024"
              style={{
                fontSize: 12,
                padding: "3px 8px",
                border: "1px solid #d1d5db",
                borderRadius: 4,
                flex: 1,
              }}
              autoFocus
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, minWidth: 120 }}>
              置換文字列
            </label>
            <input
              type="text"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="例: _2025"
              style={{
                fontSize: 12,
                padding: "3px 8px",
                border: "1px solid #d1d5db",
                borderRadius: 4,
                flex: 1,
              }}
            />
          </div>
        </div>

        {/* Preview */}
        {search && preview.length > 0 && (
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 4,
              maxHeight: 200,
              overflowY: "auto",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 700,
                color: "#555",
                borderBottom: "1px solid #e2e8f0",
                background: "#f1f5f9",
              }}
            >
              プレビュー ({matchCount}/{selectedInsertRows.length} 件が変更されます)
            </div>
            {preview.map((p, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "3px 10px",
                  fontSize: 11,
                  borderBottom: "1px solid #f0f0f5",
                  opacity: p.matches ? 1 : 0.45,
                }}
              >
                <span style={{ fontFamily: "monospace", flex: 1, color: "#555" }}>
                  {p.oldVal}
                </span>
                {p.matches ? (
                  <>
                    <span style={{ margin: "0 8px", color: "#999" }}>→</span>
                    <span
                      style={{
                        fontFamily: "monospace",
                        flex: 1,
                        color: "#166534",
                        fontWeight: 600,
                      }}
                    >
                      {p.newVal}
                    </span>
                  </>
                ) : (
                  <span style={{ flex: 1, color: "#999", fontStyle: "italic" }}>
                    スキップ（不一致）
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>キャンセル</button>
          <button
            className="primary"
            onClick={handleApply}
            disabled={!search || matchCount === 0}
          >
            適用 ({matchCount} 件)
          </button>
        </div>
      </div>
    </div>
  );
}
