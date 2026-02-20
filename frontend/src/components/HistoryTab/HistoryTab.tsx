import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, CellClassParams } from "ag-grid-community";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";
import type { Branch, HistoryCommit, DiffSummaryEntry, DiffRow } from "../../types/api";

// --- Ref Selector (Branch + Version) ---
function RefSelector({
  label,
  branches,
  selectedBranch,
  selectedVersion,
  commits,
  loadingCommits,
  onBranchChange,
  onVersionChange,
}: {
  label: string;
  branches: Branch[];
  selectedBranch: string;
  selectedVersion: string;
  commits: HistoryCommit[];
  loadingCommits: boolean;
  onBranchChange: (branch: string) => void;
  onVersionChange: (version: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#555", minWidth: 36 }}>{label}:</span>
      <select
        value={selectedBranch}
        onChange={(e) => onBranchChange(e.target.value)}
        style={{ fontSize: 12, padding: "3px 6px", minWidth: 140 }}
      >
        <option value="">-- ブランチ --</option>
        {branches.map((b) => (
          <option key={b.name} value={b.name}>{b.name}</option>
        ))}
      </select>
      <span style={{ fontSize: 11, color: "#888" }}>@</span>
      <select
        value={selectedVersion}
        onChange={(e) => onVersionChange(e.target.value)}
        disabled={!selectedBranch || loadingCommits}
        style={{ fontSize: 12, padding: "3px 6px", minWidth: 160 }}
      >
        <option value="HEAD">HEAD（最新）</option>
        {commits.map((c) => (
          <option key={c.hash} value={c.hash}>
            {c.hash.substring(0, 8)} — {c.message?.substring(0, 40) || "メッセージなし"}
          </option>
        ))}
      </select>
    </div>
  );
}

// --- DiffSummary Table ---
function DiffSummaryTable({
  entries,
  onSelectTable,
  selectedTable,
}: {
  entries: DiffSummaryEntry[];
  onSelectTable: (table: string) => void;
  selectedTable: string | null;
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
          <th style={{ textAlign: "center", padding: "4px 8px", width: 60 }}></th>
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
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "差分の読み込みに失敗しました");
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
      // Store from values for change detection
      for (const col of allCols) {
        flat[col] = values?.[col] != null ? values[col] : "";
        flat[`_from_${col}`] = row.from?.[col] != null ? row.from[col] : "";
        flat[`_to_${col}`] = row.to?.[col] != null ? row.to[col] : "";
      }
      return flat;
    });
  }, [rows, allCols]);

  // AG Grid column definitions
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
        const row = params.data;
        const dt = row._diff_type as string;
        const fromVal = String(row[`_from_${col}`] ?? "");
        const toVal = String(row[`_to_${col}`] ?? "");
        const isChanged = dt === "modified" && fromVal !== toVal;
        const displayVal = params.value != null ? String(params.value) : "";

        if (isChanged) {
          return `${displayVal} <span style="font-size:10px;color:#92400e;margin-left:4px">(旧: ${fromVal})</span>`;
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

  // Count by type from summaryEntry
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
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {tableName} の変更
          </span>
          <span style={{ fontSize: 11, color: "#a0a0c0" }}>
            {fromRef} → {toRef}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Diff type filter */}
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

      {/* Error */}
      {error && (
        <div style={{ padding: "8px 16px", background: "#fee2e2", color: "#991b1b", fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* AG Grid */}
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
          defaultColDef={{
            sortable: true,
            resizable: true,
          }}
        />
      </div>

      {/* Footer: stats + pagination */}
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

// --- Commit Log with per-commit DiffSummary ---
function CommitLog({ targetId, dbName, branchName }: {
  targetId: string;
  dbName: string;
  branchName: string;
}) {
  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [commitDiff, setCommitDiff] = useState<DiffSummaryEntry[]>([]);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const pageSize = 20;

  useEffect(() => {
    setPage(1);
    setExpandedCommit(null);
  }, [targetId, dbName, branchName]);

  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    setError(null);
    const filter = branchName === "main" ? "merges_only" : "exclude_auto_merge";
    api.getHistoryCommits(targetId, dbName, branchName, page, pageSize, filter)
      .then((data) => setCommits(data || []))
      .catch((err) => {
        const e = err as { error?: { message?: string } };
        setError(e?.error?.message || "コミット履歴の読み込みに失敗しました");
      })
      .finally(() => setLoading(false));
  }, [targetId, dbName, branchName, page, expanded]);

  // Load DiffSummary for a specific commit (compare commit vs its parent)
  const handleExpandCommit = async (hash: string) => {
    if (expandedCommit === hash) {
      setExpandedCommit(null);
      return;
    }
    setExpandedCommit(hash);
    setLoadingDiff(true);
    setCommitDiff([]);

    try {
      // Compare parent (hash~1) with this commit (hash)
      const res = await api.getDiffSummary(targetId, dbName, branchName, `${hash}~1`, hash, "two_dot");
      setCommitDiff(res.entries || []);
    } catch {
      // If parent doesn't exist (first commit), show empty
      setCommitDiff([]);
    } finally {
      setLoadingDiff(false);
    }
  };

  return (
    <div style={{ borderTop: "1px solid #e0e0e0", paddingTop: 8, marginTop: 12 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{ fontSize: 12, fontWeight: 600, color: "#555", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {expanded ? "▼" : "▶"} コミット履歴 — {branchName}
      </button>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          {loading && <div style={{ fontSize: 12, color: "#888" }}>読み込み中...</div>}
          {error && <div style={{ fontSize: 12, color: "#991b1b" }}>{error}</div>}
          {!loading && !error && commits.length === 0 && (
            <div style={{ fontSize: 12, color: "#888" }}>コミットが見つかりません。</div>
          )}
          {commits.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {commits.map((c) => (
                <div key={c.hash}>
                  <div
                    onClick={() => handleExpandCommit(c.hash)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderBottom: "1px solid #f0f0f5",
                      cursor: "pointer",
                      background: expandedCommit === c.hash ? "#f0f4ff" : undefined,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ fontSize: 10, width: 12 }}>
                      {expandedCommit === c.hash ? "▼" : "▶"}
                    </span>
                    <span style={{ fontFamily: "monospace", color: "#4361ee", minWidth: 65 }}>
                      {c.hash.substring(0, 8)}
                    </span>
                    <span style={{ color: "#888", minWidth: 100, fontSize: 11 }}>
                      {c.timestamp ? c.timestamp.substring(0, 16).replace("T", " ") : "—"}
                    </span>
                    <span style={{ color: "#555", flex: 1 }}>{c.message}</span>
                    <span style={{ color: "#aaa", fontSize: 11 }}>{c.author}</span>
                  </div>
                  {/* Per-commit DiffSummary */}
                  {expandedCommit === c.hash && (
                    <div style={{ padding: "6px 8px 6px 28px", background: "#fafbff", borderBottom: "1px solid #e8e8f0" }}>
                      {loadingDiff ? (
                        <span style={{ fontSize: 11, color: "#888" }}>変更テーブルを読み込み中...</span>
                      ) : commitDiff.length === 0 ? (
                        <span style={{ fontSize: 11, color: "#888" }}>このコミットにはテーブル変更がありません。</span>
                      ) : (
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                          <tbody>
                            {commitDiff.map((e) => (
                              <tr key={e.table} style={{ borderBottom: "1px solid #f0f0f5" }}>
                                <td style={{ padding: "2px 8px", fontFamily: "monospace", fontWeight: 500 }}>{e.table}</td>
                                <td style={{ textAlign: "right", padding: "2px 6px", color: "#065f46" }}>
                                  {e.added > 0 ? `+${e.added}` : ""}
                                </td>
                                <td style={{ textAlign: "right", padding: "2px 6px", color: "#92400e" }}>
                                  {e.modified > 0 ? `~${e.modified}` : ""}
                                </td>
                                <td style={{ textAlign: "right", padding: "2px 6px", color: "#991b1b" }}>
                                  {e.removed > 0 ? `-${e.removed}` : ""}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, justifyContent: "center" }}>
            <button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} style={{ fontSize: 12, padding: "3px 10px" }}>
              ◀ 前へ
            </button>
            <span style={{ fontSize: 12, color: "#666" }}>{page} ページ</span>
            <button disabled={commits.length < pageSize || loading} onClick={() => setPage((p) => p + 1)} style={{ fontSize: 12, padding: "3px 10px" }}>
              次へ ▶
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- History Tab (top-level) ---
export function HistoryTab() {
  const { targetId, dbName, branchName } = useContextStore();

  const [branches, setBranches] = useState<Branch[]>([]);

  // From ref
  const [fromBranch, setFromBranch] = useState("main");
  const [fromVersion, setFromVersion] = useState("HEAD");
  const [fromCommits, setFromCommits] = useState<HistoryCommit[]>([]);
  const [loadingFromCommits, setLoadingFromCommits] = useState(false);

  // To ref
  const [toBranch, setToBranch] = useState(branchName || "");
  const [toVersion, setToVersion] = useState("HEAD");
  const [toCommits, setToCommits] = useState<HistoryCommit[]>([]);
  const [loadingToCommits, setLoadingToCommits] = useState(false);

  // Comparison results
  const [entries, setEntries] = useState<DiffSummaryEntry[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [compared, setCompared] = useState(false);

  // Fullscreen DiffGrid
  const [diffGridTable, setDiffGridTable] = useState<string | null>(null);

  // Load branches
  useEffect(() => {
    if (!targetId || !dbName) return;
    api.getBranches(targetId, dbName).then(setBranches).catch(() => {});
  }, [targetId, dbName]);

  // Update toBranch when branchName changes
  useEffect(() => {
    if (branchName) setToBranch(branchName);
  }, [branchName]);

  // Load commits for From branch
  useEffect(() => {
    if (!fromBranch || !targetId || !dbName) { setFromCommits([]); return; }
    setLoadingFromCommits(true);
    api.getHistoryCommits(targetId, dbName, fromBranch, 1, 30)
      .then((data) => setFromCommits(data || []))
      .catch(() => setFromCommits([]))
      .finally(() => setLoadingFromCommits(false));
  }, [targetId, dbName, fromBranch]);

  // Load commits for To branch
  useEffect(() => {
    if (!toBranch || !targetId || !dbName) { setToCommits([]); return; }
    setLoadingToCommits(true);
    api.getHistoryCommits(targetId, dbName, toBranch, 1, 30)
      .then((data) => setToCommits(data || []))
      .catch(() => setToCommits([]))
      .finally(() => setLoadingToCommits(false));
  }, [targetId, dbName, toBranch]);

  // Resolve ref string (branch name or commit hash)
  const resolveRef = (branch: string, version: string) =>
    version === "HEAD" ? branch : version;

  const handleCompare = async () => {
    const fromRef = resolveRef(fromBranch, fromVersion);
    const toRef = resolveRef(toBranch, toVersion);
    if (!fromRef || !toRef) return;

    setLoadingSummary(true);
    setSummaryError(null);
    setEntries([]);
    setDiffGridTable(null);
    setCompared(false);

    try {
      const res = await api.getDiffSummary(targetId, dbName, branchName || "main", fromRef, toRef, "two_dot");
      setEntries(res.entries || []);
      setCompared(true);
    } catch (err) {
      const e = err as { error?: { message?: string } };
      setSummaryError(e?.error?.message || "差分サマリーの読み込みに失敗しました");
    } finally {
      setLoadingSummary(false);
    }
  };

  // Open fullscreen DiffGrid for a table
  const handleSelectTable = (table: string) => {
    setDiffGridTable(table);
  };

  const fromRefStr = resolveRef(fromBranch, fromVersion);
  const toRefStr = resolveRef(toBranch, toVersion);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "auto" }}>
        {/* Ref selectors */}
        <div style={{ padding: "12px 16px", background: "#f8fafc", borderBottom: "1px solid #d0d0d8" }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>
            2つのバージョンを選択して差分を比較します。ブランチの HEAD または特定のコミットを指定できます。
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <RefSelector
              label="From"
              branches={branches}
              selectedBranch={fromBranch}
              selectedVersion={fromVersion}
              commits={fromCommits}
              loadingCommits={loadingFromCommits}
              onBranchChange={(b) => { setFromBranch(b); setFromVersion("HEAD"); setCompared(false); }}
              onVersionChange={(v) => { setFromVersion(v); setCompared(false); }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <RefSelector
                label="To"
                branches={branches}
                selectedBranch={toBranch}
                selectedVersion={toVersion}
                commits={toCommits}
                loadingCommits={loadingToCommits}
                onBranchChange={(b) => { setToBranch(b); setToVersion("HEAD"); setCompared(false); }}
                onVersionChange={(v) => { setToVersion(v); setCompared(false); }}
              />
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
        </div>

        {/* Summary error */}
        {summaryError && (
          <div style={{ fontSize: 12, color: "#991b1b", padding: "0 16px" }}>{summaryError}</div>
        )}

        {/* DiffSummary table */}
        {compared && (
          <div style={{ padding: "0 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 }}>
              差分: {fromRefStr} → {toRefStr}
            </div>
            <DiffSummaryTable
              entries={entries}
              onSelectTable={handleSelectTable}
              selectedTable={diffGridTable}
            />
          </div>
        )}

        {/* Commit Log (collapsible, with per-commit details) */}
        <div style={{ padding: "0 16px", marginTop: "auto" }}>
          <CommitLog targetId={targetId} dbName={dbName} branchName={branchName || "main"} />
        </div>
      </div>

      {/* Fullscreen DiffGrid overlay */}
      {diffGridTable && (
        <DiffGrid
          targetId={targetId}
          dbName={dbName}
          branchName={branchName || "main"}
          tableName={diffGridTable}
          fromRef={fromRefStr}
          toRef={toRefStr}
          summaryEntry={entries.find((e) => e.table === diffGridTable)}
          onClose={() => setDiffGridTable(null)}
        />
      )}
    </>
  );
}
