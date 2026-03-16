import { useState } from "react";
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

const COLOR_A = "#fef2f2";   // light red — A group diff cell
const COLOR_B = "#eff6ff";   // light blue — B group diff cell
const COLOR_HEADER_DIFF = "#fee2e2"; // header diff column tint

export function CompareResultModal({
  result,
  allColumns,
  pkCols,
  groupA,
  groupB,
  metadata,
  onClose,
}: CompareResultModalProps) {
  const [diffColsOnly, setDiffColsOnly] = useState(true);
  const [diffPairsOnly, setDiffPairsOnly] = useState(false);

  const pairsWithDiffs = result.pairs.filter((p) => p.diffs.length > 0).length;

  const diffColSet = new Set(result.diffColumnNames);
  const dataColumns = allColumns.filter((c) => !c.name.startsWith("_"));
  const visibleColumns = diffColsOnly
    ? dataColumns.filter((c) => diffColSet.has(c.name))
    : dataColumns;

  const visiblePairs = diffPairsOnly
    ? result.pairs.filter((p) => p.diffs.length > 0)
    : result.pairs;

  // Build sorted row maps matching compareRows.ts sort order
  const sortedGroupA = [...groupA].sort(makePkSorter(pkCols));
  const sortedGroupB = [...groupB].sort(makePkSorter(pkCols));

  const handleDownloadCSV = () => {
    const csv = generateCompareCSV(result, allColumns, groupA, groupB, pkCols, metadata);
    downloadCompareCSV(csv, metadata);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{
          minWidth: 500,
          maxWidth: "min(90vw, 960px)",
          width: "min(90vw, 960px)",
          maxHeight: "85vh",
          overflowY: "auto",
          padding: "16px 20px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15 }}>行比較結果</h3>
            <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
              {result.pairs.length}ペア中 <strong>{pairsWithDiffs}</strong>ペアに差分あり
              {result.diffColumnNames.length > 0 && (
                <> / 差分カラム: {result.diffColumnNames.join(", ")} ({result.diffColumnNames.length}列)</>
              )}
            </div>
          </div>
          <button
            onClick={handleDownloadCSV}
            style={{
              flexShrink: 0,
              fontSize: 11, padding: "4px 10px",
              background: "#f0f9ff", color: "#0369a1", border: "1px solid #bae6fd",
              borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            CSVダウンロード
          </button>
        </div>

        {/* ── Controls ── */}
        <div style={{ display: "flex", gap: 20, marginBottom: 12, fontSize: 12, color: "#374151" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={diffColsOnly}
              onChange={(e) => setDiffColsOnly(e.target.checked)}
            />
            差分列のみ表示
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={diffPairsOnly}
              onChange={(e) => setDiffPairsOnly(e.target.checked)}
            />
            差分ペアのみ表示
          </label>
        </div>

        {/* ── Pair Tables ── */}
        {visiblePairs.length === 0 ? (
          <div style={{ fontSize: 13, color: "#6b7280", padding: "12px 0" }}>表示するペアがありません</div>
        ) : (
          visiblePairs.map((pair) => {
            const rowA = sortedGroupA[pair.pairIndex];
            const rowB = sortedGroupB[pair.pairIndex];
            const pairDiffCols = new Set(pair.diffs.map((d) => d.column));
            const hasDiff = pair.diffs.length > 0;

            return (
              <div
                key={pair.pairIndex}
                style={{
                  borderTop: "1px solid #e5e7eb",
                  paddingTop: 8,
                  marginTop: 8,
                }}
              >
                {/* Pair label */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                    ペア{pair.pairIndex + 1}: {pair.pkA} ↔ {pair.pkB}
                  </span>
                  {!hasDiff && (
                    <span style={{
                      fontSize: 11, padding: "1px 7px",
                      background: "#dcfce7", color: "#15803d",
                      borderRadius: 10, fontWeight: 500,
                    }}>
                      差分なし
                    </span>
                  )}
                </div>

                {/* Grid */}
                {visibleColumns.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#9ca3af", paddingLeft: 4, marginBottom: 4 }}>
                    {diffColsOnly ? "差分カラムなし" : "表示カラムなし"}
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{
                      borderCollapse: "collapse",
                      fontSize: 12,
                      width: "max-content",
                      minWidth: "100%",
                    }}>
                      <thead>
                        <tr>
                          <th style={thStyle(false)}></th>
                          {visibleColumns.map((col) => {
                            const isDiff = pairDiffCols.has(col.name);
                            return (
                              <th
                                key={col.name}
                                style={{
                                  ...thStyle(isDiff),
                                  background: isDiff ? COLOR_HEADER_DIFF : "#f9fafb",
                                }}
                              >
                                {col.name}
                                {isDiff && <span style={{ marginLeft: 4 }}>🔴</span>}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {/* A group row */}
                        <tr>
                          <td style={labelCellStyle("#fef2f2")}>A群</td>
                          {visibleColumns.map((col) => {
                            const isDiff = pairDiffCols.has(col.name);
                            return (
                              <td key={col.name} style={dataCellStyle(isDiff ? COLOR_A : undefined)}>
                                {formatValue(rowA?.[col.name])}
                              </td>
                            );
                          })}
                        </tr>
                        {/* B group row */}
                        <tr>
                          <td style={labelCellStyle("#eff6ff")}>B群</td>
                          {visibleColumns.map((col) => {
                            const isDiff = pairDiffCols.has(col.name);
                            return (
                              <td key={col.name} style={dataCellStyle(isDiff ? COLOR_B : undefined)}>
                                {formatValue(rowB?.[col.name])}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* ── Footer ── */}
        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 10, marginTop: 12, textAlign: "right" }}>
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

// ── Helpers ──

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "(null)";
  return String(v);
}

function makePkSorter(pkCols: ColumnSchema[]) {
  return (a: TableGridRow, b: TableGridRow): number => {
    for (const col of pkCols) {
      const av = a[col.name];
      const bv = b[col.name];
      if (av === bv) continue;
      if (av === null || av === undefined) return -1;
      if (bv === null || bv === undefined) return 1;
      return String(av) < String(bv) ? -1 : 1;
    }
    return 0;
  };
}

// ── Style helpers ──

function thStyle(isDiff: boolean): React.CSSProperties {
  return {
    padding: "4px 8px",
    border: "1px solid #e5e7eb",
    textAlign: "left",
    fontWeight: 600,
    whiteSpace: "nowrap",
    background: isDiff ? COLOR_HEADER_DIFF : "#f9fafb",
    color: "#374151",
  };
}

function labelCellStyle(bg: string): React.CSSProperties {
  return {
    padding: "3px 8px",
    border: "1px solid #e5e7eb",
    background: bg,
    fontWeight: 600,
    whiteSpace: "nowrap",
    color: "#374151",
    fontSize: 11,
  };
}

function dataCellStyle(bg: string | undefined): React.CSSProperties {
  return {
    padding: "3px 8px",
    border: "1px solid #e5e7eb",
    background: bg ?? "#ffffff",
    whiteSpace: "nowrap",
    color: "#111827",
    maxWidth: 240,
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}
