import type { ColumnSchema } from "../../types/api";
import type { TableGridRow } from "./rowModel";
import type { CompareResult, CompareMetadata } from "./compareRows";
import { generateCompareCSV, downloadCompareCSV } from "./compareRows";

interface CompareResultModalProps {
  result: CompareResult;
  allColumns: ColumnSchema[];
  pkCols: ColumnSchema[];
  groupA: TableGridRow[];
  groupB: TableGridRow[];
  metadata: CompareMetadata;
  onClose: () => void;
}

export function CompareResultModal({
  result,
  allColumns,
  pkCols,
  groupA,
  groupB,
  metadata,
  onClose,
}: CompareResultModalProps) {
  const pairsWithDiffs = result.pairs.filter((p) => p.diffs.length > 0).length;

  const handleDownloadCSV = () => {
    const csv = generateCompareCSV(result, allColumns, groupA, groupB, pkCols, metadata);
    downloadCompareCSV(csv, metadata);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ minWidth: 500, maxWidth: 700, maxHeight: "80vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15 }}>行比較結果</h3>
            <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
              {result.pairs.length}ペア中 {pairsWithDiffs}ペアに差分あり
              {result.diffColumnNames.length > 0 && (
                <> / 差分カラム: {result.diffColumnNames.join(", ")} ({result.diffColumnNames.length}列)</>
              )}
            </div>
          </div>
          <button
            onClick={handleDownloadCSV}
            style={{
              fontSize: 11, padding: "4px 10px",
              background: "#f0f9ff", color: "#0369a1", border: "1px solid #bae6fd",
              borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            CSVダウンロード
          </button>
        </div>

        {/* Pairs */}
        {result.pairs.map((pair) => (
          <div
            key={pair.pairIndex}
            style={{
              borderTop: "1px solid #e5e7eb",
              padding: "8px 0",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
              ペア{pair.pairIndex + 1}: {pair.pkA} ↔ {pair.pkB}
            </div>
            {pair.diffs.length === 0 ? (
              <div style={{ fontSize: 12, color: "#16a34a", paddingLeft: 12 }}>差分なし</div>
            ) : (
              <div style={{ paddingLeft: 12 }}>
                {pair.diffs.map((d) => (
                  <div key={d.column} style={{ fontSize: 12, color: "#374151", lineHeight: 1.6 }}>
                    <span style={{ fontWeight: 500 }}>{d.column}</span>:{" "}
                    <span style={{ color: "#dc2626" }}>{formatValue(d.valueA)}</span>
                    {" → "}
                    <span style={{ color: "#2563eb" }}>{formatValue(d.valueB)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Footer */}
        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 10, marginTop: 8, textAlign: "right" }}>
          <button
            onClick={onClose}
            style={{
              fontSize: 12, padding: "4px 16px",
              background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db",
              borderRadius: 4, cursor: "pointer",
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "(null)";
  return String(v);
}
