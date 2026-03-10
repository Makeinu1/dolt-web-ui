import { useState, useMemo } from "react";
import type { ColumnSchema } from "../../types/api";

interface BulkEditModalProps {
  columns: ColumnSchema[];
  selectedRows: Record<string, unknown>[];
  onApply: (column: string, value: string, mode: "replace" | "fill-empty" | "find-replace", searchValue?: string) => void;
  onClose: () => void;
}

export function BulkEditModal({
  columns,
  selectedRows,
  onApply,
  onClose,
}: BulkEditModalProps) {
  const [targetColumn, setTargetColumn] = useState(columns[0]?.name ?? "");
  const [mode, setMode] = useState<"replace" | "fill-empty" | "find-replace">("replace");
  const [value, setValue] = useState("");
  const [searchValue, setSearchValue] = useState("");

  const preview = useMemo(() => {
    if (!targetColumn) return [];
    return selectedRows.map((row) => {
      const oldVal = row[targetColumn];
      const oldStr =
        oldVal === null || oldVal === undefined ? "" : String(oldVal);
      let willChange: boolean;
      let newStr: string;
      if (mode === "find-replace") {
        willChange = searchValue !== "" && oldStr.includes(searchValue);
        newStr = willChange ? oldStr.replaceAll(searchValue, value) : oldStr;
      } else {
        willChange =
          mode === "replace" ||
          oldStr === "" ||
          oldStr === "null" ||
          oldStr === "NULL";
        newStr = willChange ? value : oldStr;
      }
      return { oldStr, newStr, willChange };
    });
  }, [selectedRows, targetColumn, value, searchValue, mode]);

  const changeCount = preview.filter((p) => p.willChange).length;

  const handleApply = () => {
    if (!targetColumn || changeCount === 0) return;
    onApply(targetColumn, value, mode, mode === "find-replace" ? searchValue : undefined);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ minWidth: 560, maxWidth: 700 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>一括編集</h2>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
          選択中の {selectedRows.length} 件に一括適用します
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginBottom: 12,
          }}
        >
          {/* Column selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label
              style={{ fontSize: 12, fontWeight: 600, minWidth: 120 }}
            >
              対象カラム
            </label>
            <select
              value={targetColumn}
              onChange={(e) => setTargetColumn(e.target.value)}
              style={{
                fontSize: 12,
                padding: "3px 6px",
                border: "1px solid #d1d5db",
                borderRadius: 4,
              }}
            >
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                  {c.primary_key ? " (PK)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Mode selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, minWidth: 120 }}>
              モード
            </label>
            <label
              style={{
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="bulk-edit-mode"
                value="replace"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
              />
              すべて置換
            </label>
            <label
              style={{
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="bulk-edit-mode"
                value="fill-empty"
                checked={mode === "fill-empty"}
                onChange={() => setMode("fill-empty")}
              />
              空欄のみ埋める
            </label>
            <label
              style={{
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="bulk-edit-mode"
                value="find-replace"
                checked={mode === "find-replace"}
                onChange={() => setMode("find-replace")}
              />
              文字を置換
            </label>
          </div>

          {/* Value input(s) */}
          {mode === "find-replace" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600, minWidth: 120 }}>
                  検索文字列
                </label>
                <input
                  type="text"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder="置換対象の文字列"
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
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="置換後の文字列"
                  style={{
                    fontSize: 12,
                    padding: "3px 8px",
                    border: "1px solid #d1d5db",
                    borderRadius: 4,
                    flex: 1,
                  }}
                />
              </div>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, minWidth: 120 }}>
                値
              </label>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="設定する値"
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
          )}
        </div>

        {/* Preview */}
        {preview.length > 0 && (
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
              プレビュー ({changeCount}/{selectedRows.length} 件が変更されます)
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
                  opacity: p.willChange ? 1 : 0.45,
                }}
              >
                <span
                  style={{ fontFamily: "monospace", flex: 1, color: "#555" }}
                >
                  {p.oldStr || "(空)"}
                </span>
                {p.willChange ? (
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
                      {p.newStr || "(空)"}
                    </span>
                  </>
                ) : (
                  <span
                    style={{
                      flex: 1,
                      color: "#999",
                      fontStyle: "italic",
                    }}
                  >
                    {mode === "find-replace" ? "スキップ（検索文字列なし）" : "スキップ（空欄以外）"}
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
            disabled={!targetColumn || changeCount === 0}
          >
            適用 ({changeCount} 件)
          </button>
        </div>
      </div>
    </div>
  );
}
