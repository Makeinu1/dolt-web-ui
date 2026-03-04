import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, CellClassParams } from "ag-grid-community";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";
import { ApiError } from "../../api/errors";
import { ErrorBoundary } from "../common/ErrorBoundary";
import type { Branch, DiffSummaryEntry, DiffRow } from "../../types/api";

// --- DiffSummary Table ---
function DiffSummaryTable({
  entries,
  onSelectTable,
  selectedTable,
  onExportZip,
  exportingZip,
}: {
  entries: DiffSummaryEntry[];
  onSelectTable: (table: string) => void;
  selectedTable: string | null;
  onExportZip?: () => void;
  exportingZip?: boolean;
}) {
  if (entries.length === 0) {
    return <div style={{ fontSize: 12, color: "#888", padding: 8 }}>変更はありません。</div>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid #d0d0d8", color: "#666" }}>
          <th style={{ textAlign: "left", padding: "4px 8px" }}>テーブル</th>
          <th style={{ textAlign: "right", padding: "4px 8px", color: "#065f46" }}>+追加</th>
          <th style={{ textAlign: "right", padding: "4px 8px", color: "#92400e" }}>~変更</th>
          <th style={{ textAlign: "right", padding: "4px 8px", color: "#991b1b" }}>-削除</th>
          <th style={{ textAlign: "center", padding: "4px 8px", width: 100 }}>
            {onExportZip && (
              <button
                onClick={(e) => { e.stopPropagation(); onExportZip(); }}
                disabled={exportingZip}
                title="全テーブルの差分を ZIP でダウンロード"
                style={{ fontSize: 11, padding: "2px 6px", cursor: "pointer", background: "#f0f4ff", border: "1px solid #4361ee", borderRadius: 4, color: "#4361ee" }}
              >
                {exportingZip ? "生成中..." : "📥 ZIP"}
              </button>
            )}
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr
            key={e.table}
            style={{
              borderBottom: "1px solid #f0f0f5",
              cursor: "pointer",
              background: selectedTable === e.table ? "#e0e7ff" : undefined,
            }}
            onClick={() => onSelectTable(e.table)}
          >
            <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{e.table}</td>
            <td style={{ textAlign: "right", padding: "4px 8px", color: "#065f46", fontWeight: e.added > 0 ? 600 : 400 }}>
              {e.added > 0 ? `+${e.added}` : "—"}
            </td>
            <td style={{ textAlign: "right", padding: "4px 8px", color: "#92400e", fontWeight: e.modified > 0 ? 600 : 400 }}>
              {e.modified > 0 ? `~${e.modified}` : "—"}
            </td>
            <td style={{ textAlign: "right", padding: "4px 8px", color: "#991b1b", fontWeight: e.removed > 0 ? 600 : 400 }}>
              {e.removed > 0 ? `-${e.removed}` : "—"}
            </td>
            <td style={{ textAlign: "center", padding: "4px 8px" }}>
              <span style={{ fontSize: 11, color: "#4361ee" }}>詳細 ▶</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Fullscreen Diff Grid (AG Grid) ---
const DIFF_PAGE_SIZE = 50;

function DiffGrid({
  targetId,
  dbName,
  branchName,
  tableName,
  fromRef,
  toRef,
  summaryEntry,
  onClose,
}: {
  targetId: string;
  dbName: string;
  branchName: string;
  tableName: string;
  fromRef: string;
  toRef: string;
  summaryEntry?: DiffSummaryEntry;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffTypeFilter, setDiffTypeFilter] = useState("");

  const loadDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDiffTable(
        targetId, dbName, branchName, tableName, fromRef, toRef,
        "two_dot", false, diffTypeFilter, page, DIFF_PAGE_SIZE
      );
      setRows(res.rows || []);
      setTotalCount(res.total_count);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "差分の読み込みに失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [targetId, dbName, branchName, tableName, fromRef, toRef, diffTypeFilter, page]);

  useEffect(() => { loadDiff(); }, [loadDiff]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [diffTypeFilter]);

  // Derive columns from rows
  const allCols = useMemo(() => {
    const colSet = new Set<string>();
    for (const row of rows) {
      if (row.from) Object.keys(row.from).forEach((k) => colSet.add(k));
      if (row.to) Object.keys(row.to).forEach((k) => colSet.add(k));
    }
    return Array.from(colSet);
  }, [rows]);

  // Flatten rows for AG Grid: { _diff_type, _from_xxx, col1, col2, ... }
  const gridRows = useMemo(() => {
    return rows.map((row, idx) => {
      const values = row.diff_type === "removed" ? row.from : row.to;
      const flat: Record<string, unknown> = {
        _rowIndex: idx,
        _diff_type: row.diff_type,
      };
      for (const col of allCols) {
        flat[col] = values?.[col] != null ? values[col] : "";
        flat[`_from_${col}`] = row.from?.[col] != null ? row.from[col] : "";
        flat[`_to_${col}`] = row.to?.[col] != null ? row.to[col] : "";
      }
      return flat;
    });
  }, [rows, allCols]);

  const columnDefs: ColDef[] = useMemo(() => {
    const typeCol: ColDef = {
      headerName: "変更",
      field: "_diff_type",
      width: 60,
      pinned: "left",
      sortable: false,
      filter: false,
      resizable: false,
      cellStyle: (params: CellClassParams) => {
        const dt = params.value as string;
        return {
          textAlign: "center",
          fontWeight: 700,
          fontFamily: "monospace",
          fontSize: "13px",
          color: dt === "added" ? "#16a34a" : dt === "removed" ? "#dc2626" : "#f59e0b",
        };
      },
      valueFormatter: (params) => {
        const dt = params.value as string;
        return dt === "added" ? "+" : dt === "removed" ? "-" : "~";
      },
    };

    const dataCols: ColDef[] = allCols.map((col) => ({
      headerName: col,
      field: col,
      sortable: true,
      filter: true,
      resizable: true,
      cellStyle: (params: CellClassParams) => {
        if (!params.data) return { fontFamily: "monospace", fontSize: "12px" };
        const row = params.data as Record<string, unknown>;
        const dt = row._diff_type as string;
        const fromVal = String(row[`_from_${col}`] ?? "");
        const toVal = String(row[`_to_${col}`] ?? "");
        const isChanged = dt === "modified" && fromVal !== toVal;

        const base: Record<string, string> = {
          fontFamily: "monospace",
          fontSize: "12px",
        };
        if (dt === "removed") {
          base.textDecoration = "line-through";
          base.color = "#888";
        }
        if (isChanged) {
          base.backgroundColor = "#fde68a";
          base.fontWeight = "700";
        }
        return base;
      },
      cellRenderer: (params: { data: Record<string, unknown>; value: unknown }) => {
        if (!params.data) return null;
        const row = params.data;
        const dt = row._diff_type as string;
        const fromVal = String(row[`_from_${col}`] ?? "");
        const toVal = String(row[`_to_${col}`] ?? "");
        const isChanged = dt === "modified" && fromVal !== toVal;
        const displayVal = params.value != null ? String(params.value) : "";

        if (isChanged) {
          const container = document.createElement("span");
          container.textContent = displayVal;
          const old = document.createElement("span");
          old.style.cssText = "font-size:10px;color:#92400e;margin-left:4px";
          old.textContent = `(旧: ${fromVal})`;
          container.appendChild(old);
          return container;
        }
        return displayVal;
      },
    }));

    return [typeCol, ...dataCols];
  }, [allCols]);

  const getRowStyle = useCallback((params: { data?: Record<string, unknown> }) => {
    const dt = params.data?._diff_type as string;
    switch (dt) {
      case "added": return { background: "#dcfce7" };
      case "removed": return { background: "#fee2e2" };
      case "modified": return { background: "#fef3c7" };
      default: return undefined;
    }
  }, []);

  const totalPages = Math.ceil(totalCount / DIFF_PAGE_SIZE);
  const addedCount = summaryEntry?.added ?? 0;
  const modifiedCount = summaryEntry?.modified ?? 0;
  const removedCount = summaryEntry?.removed ?? 0;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 200,
      background: "#fff",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 16px",
        background: "#1a1a2e",
        color: "#fff",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{tableName} の変更</span>
          <span style={{ fontSize: 11, color: "#a0a0c0" }}>{fromRef} → {toRef}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <select
            value={diffTypeFilter}
            onChange={(e) => setDiffTypeFilter(e.target.value)}
            style={{ fontSize: 12, padding: "3px 8px", background: "#2a2a3e", color: "#fff", border: "1px solid #4361ee", borderRadius: 3 }}
          >
            <option value="">全て</option>
            <option value="added">+ 追加のみ</option>
            <option value="modified">~ 変更のみ</option>
            <option value="removed">- 削除のみ</option>
          </select>
          <button
            onClick={onClose}
            style={{ fontSize: 14, background: "none", border: "none", color: "#fff", cursor: "pointer", padding: "2px 8px" }}
          >
            ✕ 閉じる
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 16px", background: "#fee2e2", color: "#991b1b", fontSize: 12 }}>{error}</div>
      )}

      <div className="ag-theme-alpine" style={{ flex: 1, minHeight: 0 }}>
        <AgGridReact
          rowData={gridRows}
          columnDefs={columnDefs}
          getRowStyle={getRowStyle}
          suppressRowClickSelection
          animateRows={false}
          loading={loading}
          enableCellTextSelection
          ensureDomOrder
          defaultColDef={{ sortable: true, resizable: true }}
        />
      </div>

      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 16px",
        background: "#f8f8fa",
        borderTop: "1px solid #e0e0e0",
        flexShrink: 0,
        fontSize: 12,
      }}>
        <div style={{ display: "flex", gap: 12, color: "#555" }}>
          <span>{totalCount}件の変更</span>
          {(addedCount > 0 || modifiedCount > 0 || removedCount > 0) && (
            <span style={{ color: "#888" }}>
              (<span style={{ color: "#065f46" }}>+{addedCount} 追加</span>
              {" / "}
              <span style={{ color: "#92400e" }}>~{modifiedCount} 変更</span>
              {" / "}
              <span style={{ color: "#991b1b" }}>-{removedCount} 削除</span>)
            </span>
          )}
        </div>
        {totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
              style={{ fontSize: 11, padding: "3px 10px", cursor: "pointer" }}
            >
              ◀ 前へ
            </button>
            <span style={{ color: "#666" }}>{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              style={{ fontSize: 11, padding: "3px 10px", cursor: "pointer" }}
            >
              次へ ▶
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- History Tab (top-level) ---
// Simplified: HEAD-to-HEAD comparison only (no commit version selector, no CommitLog).
export function HistoryTab() {
  const { targetId, dbName, branchName } = useContextStore();

  const [branches, setBranches] = useState<Branch[]>([]);

  // From / To branch (HEAD only)
  const [fromBranch, setFromBranch] = useState("main");
  const [toBranch, setToBranch] = useState(branchName || "");

  // Comparison results
  const [entries, setEntries] = useState<DiffSummaryEntry[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [compared, setCompared] = useState(false);

  // Fullscreen DiffGrid
  const [diffGridTable, setDiffGridTable] = useState<string | null>(null);
  const [exportingZip, setExportingZip] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Load branches
  useEffect(() => {
    if (!targetId || !dbName) return;
    api.getBranches(targetId, dbName).then(setBranches).catch(() => { });
  }, [targetId, dbName]);

  // Update toBranch when current branch changes
  useEffect(() => {
    if (branchName) setToBranch(branchName);
  }, [branchName]);

  const handleCompare = useCallback(async () => {
    if (!fromBranch || !toBranch) return;
    setLoadingSummary(true);
    setSummaryError(null);
    setEntries([]);
    setDiffGridTable(null);
    setCompared(false);
    try {
      const res = await api.getDiffSummary(targetId, dbName, branchName || "main", fromBranch, toBranch, "two_dot");
      setEntries(res.entries || []);
      setCompared(true);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "差分サマリーの読み込みに失敗しました";
      setSummaryError(msg);
    } finally {
      setLoadingSummary(false);
    }
  }, [targetId, dbName, branchName, fromBranch, toBranch]);

  const handleExportZip = async () => {
    setExportingZip(true);
    setExportError(null);
    try {
      const { blob, filename } = await api.exportDiffZip(targetId, dbName, branchName || "main", fromBranch, toBranch, "two_dot");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "ZIPエクスポートに失敗しました";
      setExportError(msg);
    } finally {
      setExportingZip(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "auto" }}>
        {/* Branch selectors (HEAD-to-HEAD only) */}
        <div style={{ padding: "12px 16px", background: "#f8fafc", borderBottom: "1px solid #d0d0d8" }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
            2つのブランチのHEADを比較します。
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#555", minWidth: 36 }}>From:</span>
            <select
              value={fromBranch}
              onChange={(e) => { setFromBranch(e.target.value); setCompared(false); }}
              style={{ fontSize: 12, padding: "3px 6px", minWidth: 140 }}
            >
              <option value="">-- ブランチ --</option>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))}
            </select>

            <span style={{ fontSize: 12, color: "#888" }}>→</span>

            <span style={{ fontSize: 12, fontWeight: 600, color: "#555", minWidth: 20 }}>To:</span>
            <select
              value={toBranch}
              onChange={(e) => { setToBranch(e.target.value); setCompared(false); }}
              style={{ fontSize: 12, padding: "3px 6px", minWidth: 140 }}
            >
              <option value="">-- ブランチ --</option>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))}
            </select>

            <button
              onClick={handleCompare}
              disabled={!fromBranch || !toBranch || loadingSummary}
              style={{
                fontSize: 12,
                padding: "4px 16px",
                background: "#4361ee",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                marginLeft: 8,
              }}
            >
              {loadingSummary ? "比較中..." : "比較する"}
            </button>
          </div>
        </div>

        {summaryError && (
          <div style={{ fontSize: 12, color: "#991b1b", padding: "0 16px" }}>{summaryError}</div>
        )}

        {exportError && (
          <div style={{ fontSize: 12, color: "#991b1b", padding: "0 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>⚠ {exportError}</span>
            <button onClick={() => setExportError(null)} style={{ fontSize: 11, background: "none", border: "none", cursor: "pointer", color: "#991b1b" }}>✕</button>
          </div>
        )}

        {compared && (
          <div style={{ padding: "0 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 }}>
              差分: {fromBranch} → {toBranch}
            </div>
            <DiffSummaryTable
              entries={entries}
              onSelectTable={setDiffGridTable}
              selectedTable={diffGridTable}
              onExportZip={entries.length > 0 ? handleExportZip : undefined}
              exportingZip={exportingZip}
            />
          </div>
        )}
      </div>

      {diffGridTable && (
        <ErrorBoundary>
          <DiffGrid
            targetId={targetId}
            dbName={dbName}
            branchName={branchName || "main"}
            tableName={diffGridTable}
            fromRef={fromBranch}
            toRef={toBranch}
            summaryEntry={entries.find((e) => e.table === diffGridTable)}
            onClose={() => setDiffGridTable(null)}
          />
        </ErrorBoundary>
      )}
    </>
  );
}
