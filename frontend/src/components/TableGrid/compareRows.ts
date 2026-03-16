import type { ColumnSchema } from "../../types/api";
import type { TableGridRow } from "./rowModel";
import { comparePrimitiveValues } from "./rowModel";

// --- Types ---

export interface CompareColumnDiff {
  column: string;
  valueA: unknown;
  valueB: unknown;
}

export interface ComparePairResult {
  pairIndex: number;
  pkA: string;
  pkB: string;
  diffs: CompareColumnDiff[];
}

export interface CompareResult {
  pairs: ComparePairResult[];
  diffColumnNames: string[];
}

export interface CompareMetadata {
  tableName: string;
  branchName: string;
  timestamp: string;
}

// --- Comparison ---

function valuesEqual(a: unknown, b: unknown): boolean {
  // null and undefined are treated as the same
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  // one is null/undefined, the other is not
  if (a === null || a === undefined || b === null || b === undefined) return false;
  // compare as strings for consistent behavior across types
  return String(a) === String(b);
}

function formatPk(row: TableGridRow, pkCols: ColumnSchema[]): string {
  return pkCols.map((c) => `${c.name}=${row[c.name] ?? "null"}`).join(", ");
}

export function compareRowGroups(
  groupA: TableGridRow[],
  groupB: TableGridRow[],
  pkCols: ColumnSchema[],
  allColumns: ColumnSchema[],
): CompareResult {
  const dataColumns = allColumns.filter((c) => !c.name.startsWith("_"));

  // Sort both groups by PK ascending for positional pairing
  const sortByPk = (a: TableGridRow, b: TableGridRow): number => {
    for (const col of pkCols) {
      const cmp = comparePrimitiveValues(a[col.name], b[col.name]);
      if (cmp !== 0) return cmp;
    }
    return 0;
  };
  const sortedA = [...groupA].sort(sortByPk);
  const sortedB = [...groupB].sort(sortByPk);

  const diffColumnSet = new Set<string>();
  const pairs: ComparePairResult[] = [];

  for (let i = 0; i < sortedA.length; i++) {
    const rowA = sortedA[i];
    const rowB = sortedB[i];
    const diffs: CompareColumnDiff[] = [];
    for (const col of dataColumns) {
      if (!valuesEqual(rowA[col.name], rowB[col.name])) {
        diffs.push({ column: col.name, valueA: rowA[col.name], valueB: rowB[col.name] });
        diffColumnSet.add(col.name);
      }
    }
    pairs.push({
      pairIndex: i,
      pkA: formatPk(rowA, pkCols),
      pkB: formatPk(rowB, pkCols),
      diffs,
    });
  }

  return { pairs, diffColumnNames: [...diffColumnSet] };
}

// --- CSV Generation ---

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateCompareCSV(
  result: CompareResult,
  allColumns: ColumnSchema[],
  groupA: TableGridRow[],
  groupB: TableGridRow[],
  pkCols: ColumnSchema[],
  metadata: CompareMetadata,
): string {
  const dataColumns = allColumns.filter((c) => !c.name.startsWith("_"));
  const pairsWithDiffs = result.pairs.filter((p) => p.diffs.length > 0).length;

  // Sort groups same way as compareRowGroups
  const sortByPk = (a: TableGridRow, b: TableGridRow): number => {
    for (const col of pkCols) {
      const cmp = comparePrimitiveValues(a[col.name], b[col.name]);
      if (cmp !== 0) return cmp;
    }
    return 0;
  };
  const sortedA = [...groupA].sort(sortByPk);
  const sortedB = [...groupB].sort(sortByPk);

  const lines: string[] = [];

  // Metadata comment lines
  lines.push(`# テーブル: ${metadata.tableName}, ブランチ: ${metadata.branchName}, 比較日時: ${metadata.timestamp}`);
  lines.push(`# A群: ${sortedA.length}行, B群: ${sortedB.length}行, 差分ペア: ${pairsWithDiffs}/${result.pairs.length}, 差分カラム: ${result.diffColumnNames.join(", ") || "なし"}`);

  // Header
  lines.push("ペア番号,PK(A群),PK(B群),カラム名,A群の値,B群の値,差分有無");

  // Data rows: all pairs × all columns
  for (let i = 0; i < sortedA.length; i++) {
    const rowA = sortedA[i];
    const rowB = sortedB[i];
    const pair = result.pairs[i];
    for (const col of dataColumns) {
      const valA = rowA[col.name];
      const valB = rowB[col.name];
      const hasDiff = !valuesEqual(valA, valB) ? "○" : "";
      lines.push([
        String(i + 1),
        csvEscape(pair.pkA),
        csvEscape(pair.pkB),
        csvEscape(col.name),
        csvEscape(valA),
        csvEscape(valB),
        hasDiff,
      ].join(","));
    }
  }

  return "\uFEFF" + lines.join("\n") + "\n";
}

export function downloadCompareCSV(csv: string, metadata: CompareMetadata): void {
  const now = metadata.timestamp.replace(/[-:T]/g, "").slice(0, 15).replace(/(\d{8})(\d{6})/, "$1_$2");
  const filename = `比較_${metadata.tableName}_${now}.csv`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
