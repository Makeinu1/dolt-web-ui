import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type CellValueChangedEvent,
  type FirstDataRenderedEvent,
  type GetContextMenuItemsParams,
  type MenuItemDef,
  type CellClassParams,
  type FilterChangedEvent,
  type SortChangedEvent,
  type SelectionChangedEvent,
  type CellClickedEvent,
} from "ag-grid-community";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";
import { safeGetJSON, safeSetJSON } from "../../utils/safeStorage";
import { ApiError } from "../../api/errors";
import type { ColumnSchema, RowsResponse } from "../../types/api";
import { BulkEditModal } from "../BulkPKReplaceModal/BulkEditModal";
import { stablePkJson } from "../../utils/stablePk";
import { previewBulkEdit, type BulkEditOperation } from "../../utils/bulkEdit";
import { UI_CLONE_TIMEOUT_MS } from "../../constants/ui";

ModuleRegistry.registerModules([AllCommunityModule]);
// The toolbar covers row actions in community mode; AG Grid's context menu
// requires an enterprise-only module and otherwise emits console errors.
const AG_GRID_CONTEXT_MENU_SUPPORTED = false;

// Module-level counter for unique draft row IDs
let _draftIdCounter = 0;

// --- Column toggle dropdown ---
function ColumnToggle({
  columns,
  hiddenColumns,
  onToggle,
}: {
  columns: ColumnSchema[];
  hiddenColumns: Set<string>;
  onToggle: (colName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const visibleCount = columns.length - hiddenColumns.size;

  return (
    <div className="column-toggle-wrapper" ref={ref}>
      <button
        className="toolbar-btn"
        onClick={() => setOpen(!open)}
        style={{ fontSize: 11, padding: "2px 8px" }}
      >
        ⚙ Columns ({visibleCount}/{columns.length})
      </button>
      {open && (
        <div className="column-toggle-dropdown">
          {columns.map((col) => (
            <label
              key={col.name}
              className={`column-toggle-item ${col.primary_key ? "pk-col" : ""}`}
            >
              <input
                type="checkbox"
                checked={!hiddenColumns.has(col.name)}
                disabled={col.primary_key}
                onChange={() => onToggle(col.name)}
              />
              <span>{col.name}</span>
              {col.primary_key && <span style={{ fontSize: 10, color: "#999" }}>(PK)</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main TableGrid component ---
export interface SelectedCellInfo {
  table: string;
  pk: string;
  column: string;
}

interface TableGridProps {
  tableName: string;
  refreshKey?: number;
  /** 2c: When set, reads rows from this past commit hash (read-only). */
  previewCommitHash?: string;
  /** Called when the user clicks a cell. Null when focus leaves. */
  onCellSelected?: (info: SelectedCellInfo | null) => void;
  /** Called when user wants to cross-copy selected rows to another DB */
  onCrossCopyRows?: (pks: string[]) => void;
  /** Called when user wants to view row history for a specific row */
  onShowRowHistory?: (table: string, pk: string) => void;
}

export function TableGrid({ tableName, refreshKey, previewCommitHash, onCellSelected, onCrossCopyRows, onShowRowHistory }: TableGridProps) {
  const { targetId, dbName, branchName } = useContextStore();
  // 2c: Use commit hash as branch reference for past-version read-only viewing
  const effectiveRef = previewCommitHash ?? branchName;
  const addOp = useDraftStore((s) => s.addOp);
  // Subscribe only to ops for this table (and its memo table) to prevent re-renders
  // when other tables' ops change. useShallow ensures element-level comparison.
  const memoTable = `_memo_${tableName}`;
  const draftOps = useDraftStore(
    useShallow((s) => s.ops.filter((op) => op.table === tableName || op.table === memoTable))
  );
  const setBaseState = useUIStore((s) => s.setBaseState);
  const setDuplicatePkCount = useUIStore((s) => s.setDuplicatePkCount);

  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [rowData, setRowData] = useState<Record<string, unknown>[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [gridError, setGridError] = useState<string | null>(null);
  const [serverFilter, setServerFilter] = useState("");
  const [serverSort, setServerSort] = useState("");
  const [schemaReadyKey, setSchemaReadyKey] = useState<string>("");
  const colVisibilityKey = `colVisibility/${targetId}/${dbName}/${tableName}`;
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    const saved = safeGetJSON<string[]>(localStorage, colVisibilityKey, []);
    return new Set<string>(saved);
  });
  const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
  const [showDraftOnly, setShowDraftOnly] = useState(false);
  const [commentCells, setCommentCells] = useState<Set<string>>(new Set());
  const [cloning, setCloning] = useState(false);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkEditTargetRows, setBulkEditTargetRows] = useState<Record<string, unknown>[]>([]);
  const cloningRef = useRef(false);
  const gridRef = useRef<AgGridReact>(null);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist column visibility to localStorage
  useEffect(() => {
    safeSetJSON(localStorage, colVisibilityKey, [...hiddenColumns]);
  }, [hiddenColumns, colVisibilityKey]);

  const isProtected = branchName === "main" || branchName === "audit";
  const baseState = useUIStore((s) => s.baseState);
  const removeOp = useDraftStore((s) => s.removeOp);
  const [undoableOpIndex, setUndoableOpIndex] = useState<number | null>(null);

  const pkCols = useMemo(() => columns.filter((c) => c.primary_key), [columns]);
  /**
   * Stable, canonical row ID: JSON of PK columns sorted alphabetically by key.
   * Sorted order ensures the string is identical regardless of:
   *   - AG Grid data object key insertion order
   *   - Go map iteration order (which is random)
   * Must match the normalization applied server-side when saving pk_value.
   */
  const rowPkId = useCallback(
    (row: Record<string, unknown>) => {
      return stablePkJson(Object.fromEntries(pkCols.map((c) => [c.name, row[c.name]])));
    },
    [pkCols]
  );

  const stableGridRowId = useCallback(
    (row: Record<string, unknown>) => {
      if (row._draftId != null) {
        return `draft:${row._draftId}`;
      }
      if (pkCols.length === 0) {
        return "";
      }
      return rowPkId(row);
    },
    [pkCols.length, rowPkId]
  );

  // Stable row ID for AG Grid selection — sorted PK JSON.
  // Draft insert rows carry _draftId to prevent dedup when cloning a row
  // that already exists with the same PK.
  const getRowId = useMemo(
    () => (params: { data: Record<string, unknown> }) => {
      if (params.data._draftId != null) return stableGridRowId(params.data);
      // BUG-O: use rowIndex instead of Math.random() for stable (within-session) IDs for PK-less tables.
      if (pkCols.length === 0) return `row:${(params as { rowIndex?: number }).rowIndex ?? Math.random()}`;
      return stableGridRowId(params.data);
    },
    [pkCols, stableGridRowId]
  );


  // Editing is only allowed in Idle or DraftEditing states on non-main branches
  // 2c: Also block editing when viewing a past commit
  const editingBlocked =
    !!previewCommitHash ||
    isProtected ||
    baseState === "Committing" ||
    baseState === "SchemaConflictDetected" ||
    baseState === "ConstraintViolationDetected" ||
    baseState === "StaleHeadDetected";

  // Draft operations lookup for Undo functionality (only when exactly 1 row selected)
  const effectiveSelectedRow = selectedRows.length === 1 ? selectedRows[0] : null;
  useEffect(() => {
    if (pkCols.length === 0 || !effectiveSelectedRow) {
      setUndoableOpIndex(null);
      return;
    }
    const rowId = rowPkId(effectiveSelectedRow as Record<string, unknown>);

    // Find latest operation on this row
    let foundIdx: number | null = null;
    for (let i = draftOps.length - 1; i >= 0; i--) {
      const op = draftOps[i];
      if (op.table === tableName && op.pk &&
        stablePkJson(op.pk) === rowId) {
        foundIdx = i;
        break;
      }
    }
    setUndoableOpIndex(foundIdx);
  }, [draftOps, effectiveSelectedRow, pkCols, rowPkId, tableName]);


  // Handle Undo (remove the latest draft op for this row)
  const handleUndoRow = useCallback(() => {
    if (undoableOpIndex !== null) {
      removeOp(undoableOpIndex);
    }
  }, [undoableOpIndex, removeOp]);

  // Build draft index for visualization:
  // Map of rowPkId -> { type, changedCols }
  const draftIndex = useMemo(() => {
    const index = new Map<string, { type: string; changedCols: Set<string> }>();
    if (pkCols.length === 0) return index;
    for (const op of draftOps) {
      if (op.table !== tableName) continue;
      // Build the PK map from all PK columns
      const pkMap = op.type === "insert"
        ? Object.fromEntries(pkCols.map((c) => [c.name, op.values[c.name]]))
        : (op.pk ?? {});
      const rowId = stablePkJson(pkMap);
      const existing = index.get(rowId);
      if (existing) {
        // Accumulate changed columns
        if (op.values) {
          for (const col of Object.keys(op.values)) {
            existing.changedCols.add(col);
          }
        }
        // Delete supersedes update
        if (op.type === "delete") {
          existing.type = "delete";
        }
      } else {
        const changedCols = new Set<string>(op.values ? Object.keys(op.values) : []);
        if (op.pk) {
          for (const col of Object.keys(op.pk)) changedCols.add(col);
        }
        index.set(rowId, { type: op.type, changedCols });
      }
    }
    return index;
  }, [draftOps, tableName, pkCols]);

  const derivedRows = useMemo(() => {
    if (pkCols.length === 0) return rowData;

    const nextRows = rowData.map((row) => ({ ...row }));

    for (let opIndex = 0; opIndex < draftOps.length; opIndex += 1) {
      const op = draftOps[opIndex];
      if (op.table !== tableName) continue;

      if (op.type === "update" && op.pk) {
        const targetPkId = stablePkJson(op.pk);
        const rowIndex = nextRows.findIndex((row) => row._draftId == null && rowPkId(row) === targetPkId);
        if (rowIndex !== -1) {
          nextRows[rowIndex] = { ...nextRows[rowIndex], ...(op.values ?? {}) };
        }
        continue;
      }

      if (op.type === "insert") {
        const targetPkId = stablePkJson(Object.fromEntries(pkCols.map((c) => [c.name, op.values[c.name]])));
        const rowIndex = nextRows.findIndex((row) => row._draftId != null && rowPkId(row) === targetPkId);
        const draftId = rowIndex !== -1 ? nextRows[rowIndex]._draftId : `restored:${opIndex}`;
        const draftRow = { ...(op.values as Record<string, unknown>), _draftId: draftId };
        if (rowIndex !== -1) {
          nextRows[rowIndex] = draftRow;
        } else {
          nextRows.push(draftRow);
        }
      }
    }

    return nextRows;
  }, [draftOps, pkCols, rowData, rowPkId, tableName]);


  // Feature 3: INSERT rows whose PK collides with an existing (non-draft) DB row
  const duplicatePkIds = useMemo(() => {
    if (pkCols.length === 0) return new Set<string>();
    const dbRowPkIds = new Set(
      derivedRows.filter((r) => r._draftId == null).map((r) => rowPkId(r))
    );
    const dups = new Set<string>();
    for (const row of derivedRows) {
      if (row._draftId == null) continue;
      const id = rowPkId(row);
      if (dbRowPkIds.has(id)) dups.add(id);
    }
    return dups;
  }, [derivedRows, pkCols, rowPkId]);

  // Keep UIStore in sync so CommitDialog can read the count
  useEffect(() => {
    setDuplicatePkCount(duplicatePkIds.size);
  }, [duplicatePkIds.size, setDuplicatePkCount]);

  // P2: Filter derived rows to show only draft rows when showDraftOnly is active
  const displayRows = useMemo(() => {
    if (!showDraftOnly) return derivedRows;
    return derivedRows.filter((row) => {
      if (row._draftId != null) return true;
      if (pkCols.length === 0) return false;
      return draftIndex.has(rowPkId(row));
    });
  }, [derivedRows, showDraftOnly, draftIndex, pkCols, rowPkId]);

  // Load schema
  useEffect(() => {
    if (!tableName) return;
    let cancelled = false;
    const currentSchemaKey = `${tableName}|${effectiveRef}`;
    setGridError(null);
    setSchemaReadyKey("");        // ガード ON: loadRows をブロック
    setServerFilter("");          // フィルタリセット
    setServerSort("");            // ソートリセット
    setPage(1);                   // ページリセット
    setShowDraftOnly(false);      // ドラフトフィルタリセット
    gridRef.current?.api?.setFilterModel({});
    gridRef.current?.api?.applyColumnState({ defaultState: { sort: null } });
    api
      .getTableSchema(targetId, dbName, effectiveRef, tableName)
      .then((schema) => {
        if (cancelled) return;
        setColumns(schema.columns);
        setHiddenColumns(new Set());
        setSelectedRows([]);
        setSchemaReadyKey(currentSchemaKey); // ガード OFF: loadRows を解禁
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof ApiError ? err.message : "スキーマの読み込みに失敗しました";
        setGridError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [targetId, dbName, effectiveRef, tableName]);

  // Load rows (server-side filter + sort)
  const rowsRequestIdRef = useRef(0);
  const loadRows = useCallback(() => {
    if (!tableName || schemaReadyKey !== `${tableName}|${effectiveRef}`) return; // スキーマ未ロードならスキップ
    const requestId = ++rowsRequestIdRef.current;
    setLoading(true);
    setGridError(null);
    api
      .getTableRows(targetId, dbName, effectiveRef, tableName, page, pageSize, serverFilter, serverSort)
      .then((res: RowsResponse) => {
        if (rowsRequestIdRef.current !== requestId) return;
        setRowData(res.rows || []);
        setTotalCount(res.total_count);
      })
      .catch((err) => {
        if (rowsRequestIdRef.current !== requestId) return;
        const msg = err instanceof ApiError ? err.message : "データの読み込みに失敗しました";
        setGridError(msg);
      })
      .finally(() => {
        if (rowsRequestIdRef.current === requestId) {
          setLoading(false);
        }
      });
  }, [targetId, dbName, effectiveRef, tableName, page, pageSize, serverFilter, serverSort, schemaReadyKey]);

  const loadRowsRef = useRef(loadRows);
  useEffect(() => {
    loadRowsRef.current = loadRows;
  }, [loadRows]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  // P1: refreshKey専用useEffect — コミット成功後のグリッドリロード
  const lastRefreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey == null || refreshKey === lastRefreshKeyRef.current) return;
    lastRefreshKeyRef.current = refreshKey;
    loadRowsRef.current();
  }, [refreshKey]);

  // BUG-I: split getMemoMap into two effects to avoid API call on every draftOps change.
  // Effect 1: fetch base memo map from API (only on tableName/branch change).
  const [baseMemoMap, setBaseMemoMap] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!tableName || !targetId || !dbName || !effectiveRef) return;
    let cancelled = false;
    api.getMemoMap(targetId, dbName, effectiveRef, tableName)
      .then((res) => {
        if (!cancelled) setBaseMemoMap(new Set(res.cells));
      })
      .catch(() => {
        if (!cancelled) setBaseMemoMap(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [targetId, dbName, effectiveRef, tableName]);

  // Effect 2: merge draft ops locally (no API call, runs on draftOps change).
  useEffect(() => {
    if (!tableName) return;
    const cells = new Set(baseMemoMap);
    for (const op of draftOps) {
      if (op.table !== memoTable) continue;
      let pkVal: string, colName: string;
      if (op.type === "insert") {
        pkVal = String(op.values?.pk_value ?? "");
        colName = String(op.values?.column_name ?? "");
      } else {
        pkVal = String(op.pk?.pk_value ?? "");
        colName = String(op.pk?.column_name ?? "");
      }
      const key = `${pkVal}:${colName}`;
      if (op.type === "delete") cells.delete(key);
      else cells.add(key);
    }
    setCommentCells(cells);
  }, [baseMemoMap, draftOps, tableName]);

  // Optimistic row insert (used after clone)
  const onRowInserted = useCallback((row: Record<string, unknown>) => {
    setRowData((prev) => [...prev, row]);
    setTotalCount((c) => c + 1);
  }, []);

  // Selection changed handler
  const onSelectionChanged = useCallback((event: SelectionChangedEvent) => {
    setSelectedRows(event.api.getSelectedRows() as Record<string, unknown>[]);
  }, []);

  // --- Shared action functions (used by both right-click menu and toolbar buttons) ---

  // Cell click handler — notifies parent of selected cell for comment panel
  const onCellClicked = useCallback((event: CellClickedEvent) => {
    if (!onCellSelected || pkCols.length === 0 || !event.data) {
      onCellSelected?.(null);
      return;
    }
    const colName = event.column.getColDef().field ?? "";
    // pk is JSON of all PK columns for composite PK support
    const pkVal = rowPkId(event.data as Record<string, unknown>);
    onCellSelected({ table: tableName, pk: pkVal, column: colName });
  }, [onCellSelected, pkCols, rowPkId, tableName]);

  const handleCloneRows = useCallback(async (rows: Record<string, unknown>[]) => {
    if (pkCols.length === 0 || cloningRef.current) return;
    cloningRef.current = true;
    setCloning(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UI_CLONE_TIMEOUT_MS);

    try {
      for (const row of rows) {
        if (controller.signal.aborted) break;
        try {
          const result = await api.previewClone({
            target_id: targetId,
            db_name: dbName,
            branch_name: branchName,
            table: tableName,
            template_pk: Object.fromEntries(pkCols.map((c) => [c.name, row[c.name]])),
          }, controller.signal);
          if (result.errors?.length > 0) {
            useUIStore.getState().setError(result.errors[0].message);
            break;
          } else {
            for (const op of result.ops) {
              addOp(op);
            }
            setBaseState("DraftEditing");
            const insertOp = result.ops.find((op: { type: string }) => op.type === "insert");
            if (insertOp) {
              // Attach a unique _draftId so AG Grid treats this as a distinct row
              // even when the PK matches an existing row (PK-preserving clone).
              const displayRow = { ...(insertOp.values as Record<string, unknown>), _draftId: ++_draftIdCounter };
              onRowInserted(displayRow);
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            useUIStore.getState().setError("コピーがタイムアウトしました（30秒）");
          } else {
            const msg = err instanceof ApiError ? err.message : "";
            useUIStore.getState().setError("コピーに失敗しました" + (msg ? ": " + msg : ""));
          }
          break;
        }
      }
    } finally {
      clearTimeout(timeoutId);
      cloningRef.current = false;
      setCloning(false);
    }
  }, [pkCols, tableName, targetId, dbName, branchName, addOp, setBaseState, onRowInserted]);

  const handleDeleteRows = useCallback((rows: Record<string, unknown>[]) => {
    if (pkCols.length === 0) return;
    for (const row of rows) {
      const pk = Object.fromEntries(pkCols.map((c) => [c.name, row[c.name]]));
      addOp({
        type: "delete",
        table: tableName,
        values: {},
        pk,
      });
    }
    setBaseState("DraftEditing");
  }, [pkCols, tableName, addOp, setBaseState]);


  const rowHasDraft = useCallback((row: Record<string, unknown>) => {
    if (row._draftId != null) return true;
    if (pkCols.length === 0) return false;
    return draftIndex.has(rowPkId(row));
  }, [draftIndex, pkCols.length, rowPkId]);

  const selectedRowsContainDrafts = useMemo(
    () => selectedRows.some((row) => rowHasDraft(row)),
    [rowHasDraft, selectedRows]
  );
  const tableHasDrafts = draftIndex.size > 0;
  const crossCopyDisabledReason = "未コミット変更は他DBコピーに含まれません。先にCommitするか、変更をクリアしてください。";
  const canCrossCopyRows = !!onCrossCopyRows;
  const canEditRows = !isProtected && !editingBlocked;

  // P5: 一括置換 — 選択行の任意カラムを一括適用
  const handleBulkEdit = useCallback(
    (column: string, operation: BulkEditOperation) => {
      if (pkCols.length === 0) return;
      const targetRows = bulkEditTargetRows;
      const selectionRemap = targetRows.map((row) => {
        const updatedRow = { ...row };
        const preview = previewBulkEdit(row[column], operation);
        if (preview.willChange) {
          updatedRow[column] = preview.newStr;
        }
        return {
          oldId: stableGridRowId(row),
          newId: updatedRow._draftId != null
            ? `draft:${updatedRow._draftId}`
            : stablePkJson(Object.fromEntries(pkCols.map((c) => [c.name, updatedRow[c.name]]))),
        };
      });
      const targetSet = new Set(
        targetRows.map((row) => stableGridRowId(row))
      );
      for (const row of targetRows) {
        const preview = previewBulkEdit(row[column], operation);
        if (!preview.willChange) {
          continue;
        }
        const pk = Object.fromEntries(pkCols.map((c) => [c.name, row[c.name]]));
        addOp({ type: "update", table: tableName, values: { [column]: preview.newStr }, pk });
      }
      // Update rowData for immediate visual feedback
      setRowData((prev) =>
        prev.map((row) => {
          const rowKey = stableGridRowId(row);
          if (!targetSet.has(rowKey)) return row;
          const preview = previewBulkEdit(row[column], operation);
          if (!preview.willChange) {
            return row;
          }
          return { ...row, [column]: preview.newStr };
        })
      );
      requestAnimationFrame(() => {
        const gridApi = gridRef.current?.api;
        if (!gridApi) return;
        gridApi.deselectAll();
        for (const { newId } of selectionRemap) {
          if (!newId) continue;
          gridApi.getRowNode(newId)?.setSelected(true);
        }
      });
      setBaseState("DraftEditing");
    },
    [bulkEditTargetRows, tableName, pkCols, addOp, setBaseState, stableGridRowId]
  );

  // Shared helper: fetch all rows matching the current server filter (up to 1000)
  const fetchAllFilteredRows = useCallback(async (): Promise<Record<string, unknown>[] | null> => {
    const msg =
      totalCount > 1000
        ? `フィルタ結果は ${totalCount.toLocaleString()} 件ですが、最大 1,000 件のみ対象です。続けますか？`
        : `フィルタ結果の ${totalCount.toLocaleString()} 件を対象にします。続けますか？`;
    if (!window.confirm(msg)) return null;
    setFetchingAll(true);
    try {
      const res = await api.getTableRows(
        targetId, dbName, effectiveRef, tableName, 1, 50, serverFilter, serverSort, true
      );
      return res.rows || [];
    } catch (err: unknown) {
      const errMsg = err instanceof ApiError ? err.message : "";
      useUIStore.getState().setError("全件取得に失敗しました" + (errMsg ? ": " + errMsg : ""));
      return null;
    } finally {
      setFetchingAll(false);
    }
  }, [totalCount, targetId, dbName, effectiveRef, tableName, serverFilter, serverSort]);

  // Feature 2: Clone all rows matching the current server filter (up to 1000)
  const handleCloneAllFiltered = useCallback(async () => {
    const rows = await fetchAllFilteredRows();
    if (!rows) return;
    await handleCloneRows(rows);
  }, [fetchAllFilteredRows, handleCloneRows]);

  // U2: Bulk edit all filtered rows
  const handleBulkEditAllFiltered = useCallback(async () => {
    const rows = await fetchAllFilteredRows();
    if (!rows) return;
    setBulkEditTargetRows(rows);
    setShowBulkEditModal(true);
  }, [fetchAllFilteredRows]);

  // U2: Delete all filtered rows
  const handleDeleteAllFiltered = useCallback(async () => {
    const rows = await fetchAllFilteredRows();
    if (!rows) return;
    if (!window.confirm(`${rows.length} 件を削除します。この操作は取り消せません。続けますか？`)) return;
    handleDeleteRows(rows);
  }, [fetchAllFilteredRows, handleDeleteRows]);

  // U2: Cross-copy all filtered rows
  const handleCrossCopyAllFiltered = useCallback(async () => {
    if (!onCrossCopyRows || tableHasDrafts) return;
    const rows = await fetchAllFilteredRows();
    if (!rows) return;
    const pks = rows.map((r) => rowPkId(r));
    onCrossCopyRows(pks);
  }, [fetchAllFilteredRows, onCrossCopyRows, rowPkId, tableHasDrafts]);

  // Toggle column visibility
  const handleColumnToggle = useCallback((colName: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(colName)) {
        next.delete(colName);
      } else {
        next.add(colName);
      }
      return next;
    });
  }, []);

  // Right-click context menu (uses shared action functions)
  const getContextMenuItems = useCallback(
    (params: GetContextMenuItemsParams) => {
      if (!params.node || !params.node.data) {
        return ["copy" as unknown as MenuItemDef];
      }

      const rowNode = params.node.data as Record<string, unknown>;

      if (editingBlocked && !canCrossCopyRows) {
        return ["copy" as unknown as MenuItemDef];
      }

      // If the right-clicked row is in the current selection and multiple rows are selected,
      // operate on all selected rows; otherwise operate on just the right-clicked row.
      const isInSelection = selectedRows.some((r) => rowPkId(r) === rowPkId(rowNode));
      const targetRows = isInSelection && selectedRows.length > 1 ? selectedRows : [rowNode];
      const n = targetRows.length;
      const targetRowsContainDrafts = targetRows.some((row) => rowHasDraft(row));

      const crossCopyItem: MenuItemDef = {
        name: n > 1 ? `選択 ${n} 行を他DBへコピー` : "他DBへコピー",
        action: () => {
          if (onCrossCopyRows) {
            onCrossCopyRows(targetRows.map((r) => rowPkId(r)));
          }
        },
        disabled: pkCols.length === 0 || !onCrossCopyRows || targetRowsContainDrafts,
      };

      if (isProtected) {
        const items: MenuItemDef[] = [];
        if (onCrossCopyRows) {
          items.push(crossCopyItem, "separator" as unknown as MenuItemDef);
        }
        items.push("copy" as unknown as MenuItemDef);
        return items;
      }

      if (editingBlocked) {
        return ["copy" as unknown as MenuItemDef];
      }

      const cloneItem: MenuItemDef = {
        name: n > 1 ? `選択 ${n} 行をコピー` : "行をコピー",
        action: () => handleCloneRows(targetRows),
        disabled: pkCols.length === 0,
      };

      const deleteItem: MenuItemDef = {
        name: n > 1 ? `選択 ${n} 行を削除` : "行を削除",
        action: () => handleDeleteRows(targetRows),
        disabled: pkCols.length === 0,
        cssClasses: ["ag-menu-option-danger"],
      };

      const items: MenuItemDef[] = [cloneItem];
      if (onCrossCopyRows) {
        items.push(crossCopyItem);
      }
      items.push(
        deleteItem,
        "separator" as unknown as MenuItemDef,
        "copy" as unknown as MenuItemDef,
      );
      return items;
    },
    [isProtected, editingBlocked, canCrossCopyRows, pkCols, selectedRows, rowPkId, handleCloneRows, handleDeleteRows, onCrossCopyRows, rowHasDraft]
  );

  // Convert AG Grid filter model to backend FilterCondition[] JSON.
  // Debounced 300ms to avoid excessive API calls during rapid filter typing.
  const onFilterChanged = useCallback((event: FilterChangedEvent) => {
    const model = event.api.getFilterModel();
    const conditions: { column: string; op: string; value?: unknown }[] = [];
    for (const [col, filter] of Object.entries(model)) {
      const f = filter as { filterType?: string; type?: string; filter?: string; dateFrom?: string };
      if (!f.type) continue;
      const agType = f.type;
      let op = "";
      let value: unknown = f.filter ?? f.dateFrom;
      switch (agType) {
        case "contains": op = "contains"; break;
        case "equals": op = "eq"; break;
        case "notEqual": op = "neq"; break;
        case "startsWith": op = "startsWith"; break;
        case "endsWith": op = "endsWith"; break;
        case "blank": op = "blank"; value = undefined; break;
        case "notBlank": op = "notBlank"; value = undefined; break;
        default: continue;
      }
      const cond: { column: string; op: string; value?: unknown } = { column: col, op };
      if (value !== undefined) cond.value = value;
      conditions.push(cond);
    }
    const newFilter = conditions.length > 0 ? JSON.stringify(conditions) : "";
    if (filterDebounceRef.current !== null) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => {
      setServerFilter(newFilter);
      setPage(1);
      filterDebounceRef.current = null;
    }, 300);
  }, []);

  // Convert AG Grid sort model to backend sort string.
  // Debounced 300ms to batch rapid multi-column sort changes.
  const onSortChanged = useCallback((event: SortChangedEvent) => {
    const sortModel = event.api.getColumnState()
      .filter((c) => c.sort)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    const parts = sortModel.map((c) =>
      c.sort === "desc" ? `-${c.colId}` : c.colId
    );
    const newSort = parts.join(",");
    if (sortDebounceRef.current !== null) clearTimeout(sortDebounceRef.current);
    sortDebounceRef.current = setTimeout(() => {
      setServerSort(newSort);
      setPage(1);
      sortDebounceRef.current = null;
    }, 300);
  }, []);

  // Column definitions for AG Grid with draft visualization
  const colDefs: ColDef[] = useMemo(() => {
    const visibleCols = [...columns.filter((col) => !hiddenColumns.has(col.name))].sort((a, b) => {
      if (a.name === "Dolt_Description") return -1;
      if (b.name === "Dolt_Description") return 1;
      return 0;
    });

    return visibleCols.map((col, index) => ({
      field: col.name,
      headerName: col.name,
      editable: !editingBlocked,  // PK columns are also editable (PK_COLLISION caught server-side)
      ...(col.name === "Dolt_Description" ? { pinned: "left" as const } : {}),
      ...(index === 0 ? { checkboxSelection: true, headerCheckboxSelection: true } : {}),
      sortable: true,
      filter: true,
      resizable: true,
      cellStyle: (params: CellClassParams) => {
        // PK column always has a subtle bg
        const base: Record<string, string> = col.primary_key
          ? { backgroundColor: "#f0f0f5", fontWeight: "600" }
          : {};

        if (!params.data) return base;
        const rowId = rowPkId(params.data as Record<string, unknown>);
        const draft = draftIndex.get(rowId);

        if (!draft) return base;

        // Row-level draft markers
        if (draft.type === "insert") {
          // Feature 3: orange when PK collides with an existing DB row (not yet replaced)
          if (duplicatePkIds.has(rowId)) {
            return { ...base, backgroundColor: "#ffedd5", ...(col === visibleCols[0] ? { borderLeft: "3px solid #ea580c" } : {}) };
          }
          return { ...base, backgroundColor: "#dcfce7", ...(col === visibleCols[0] ? { borderLeft: "3px solid #16a34a" } : {}) };
        }
        if (draft.type === "delete") {
          return { ...base, backgroundColor: "#fee2e2", textDecoration: "line-through", color: "#888", ...(col === visibleCols[0] ? { borderLeft: "3px solid #dc2626" } : {}) };
        }
        if (draft.type === "update") {
          // Cell-level: highlight only changed columns
          if (draft.changedCols.has(col.name)) {
            return { ...base, backgroundColor: "#fef3c7", fontWeight: "600", ...(col === visibleCols[0] ? { borderLeft: "3px solid #f59e0b" } : {}) };
          }
          // Row marker on first visible column
          if (col === visibleCols[0]) {
            return { ...base, borderLeft: "3px solid #f59e0b" };
          }
        }

        // Comment marker: amber triangle in top-right corner (CSS gradient)
        const cellKey = `${rowPkId(params.data as Record<string, unknown>)}:${col.name}`;

        if (commentCells.has(cellKey)) {
          const bg = base.backgroundColor || "#ffffff";
          // Remove backgroundColor to avoid conflict with background shorthand
          const { backgroundColor: _bg, ...rest } = base;
          void _bg;
          return {
            ...rest,
            background: `linear-gradient(225deg, #f59e0b 6px, transparent 6px) no-repeat top right, ${bg}`,
          };
        }

        return base;
      },
    }));
  }, [columns, hiddenColumns, editingBlocked, draftIndex, duplicatePkIds, commentCells, pkCols, rowPkId]);


  // Auto-size columns to fit content on first data render
  const onFirstDataRendered = useCallback((event: FirstDataRenderedEvent) => {
    event.api.autoSizeAllColumns();
  }, []);

  // Handle cell edit: build op.pk from ALL PK columns (composite support)
  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      if (pkCols.length === 0) return;

      const changedCol = event.colDef.field;
      if (!changedCol) return;

      // When a PK column is changed, use event.oldValue for that column to build
      // the WHERE clause — event.data already holds the updated value at this point.
      const pk = Object.fromEntries(
        pkCols.map((c) => [
          c.name,
          c.name === changedCol ? event.oldValue : event.data[c.name],
        ])
      );

      addOp({
        type: "update",
        table: tableName,
        values: { [changedCol]: event.newValue },
        pk,
      });
      setBaseState("DraftEditing");
    },
    [pkCols, tableName, addOp, setBaseState]
  );


  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const showPagination = totalPages > 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Grid error banner */}
      {gridError && (
        <div style={{ padding: "6px 10px", background: "#fee2e2", color: "#991b1b", fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <span>⚠ {gridError}</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => { setGridError(null); loadRows(); }} style={{ fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>再試行</button>
            <button onClick={() => setGridError(null)} style={{ fontSize: 11, padding: "0 6px", background: "none", border: "none", cursor: "pointer", color: "#991b1b" }}>✕</button>
          </div>
        </div>
      )}
      {/* Toolbar: row info + action buttons + column toggle */}
      <div style={{ display: "flex", alignItems: "center", padding: "2px 8px", background: "#fafafa", borderBottom: "1px solid #e8e8f0", flexShrink: 0, gap: 4 }}>
        <span style={{ fontSize: 11, color: "#888", marginRight: "auto" }}>
          {totalCount.toLocaleString()} rows {loading && "• Loading..."}
        </span>

        {/* P2: Draft-only toggle — visible when draft ops exist */}
        {!editingBlocked && draftIndex.size > 0 && (
          <button
            onClick={() => setShowDraftOnly((v) => !v)}
            style={{ fontSize: 11, padding: "2px 8px", background: showDraftOnly ? "#fef9c3" : "#f3f4f6", color: showDraftOnly ? "#713f12" : "#4b5563", border: `1px solid ${showDraftOnly ? "#fde68a" : "#d1d5db"}`, borderRadius: 4, cursor: "pointer" }}
            title="ドラフト行のみ表示"
          >
            📝 ドラフトのみ
          </button>
        )}

        {/* Row action buttons (visible when 1+ rows are selected and not blocked) */}
        {selectedRows.length > 0 && (canEditRows || canCrossCopyRows) && (
          <div style={{ display: "flex", gap: 2, alignItems: "center", marginRight: 8 }}>
            {/* P3: Unified copy button — selected rows take priority over filter */}
            {canEditRows && pkCols.length > 0 && (
              <button
                onClick={() => handleCloneRows(selectedRows)}
                disabled={cloning || fetchingAll}
                style={{ fontSize: 11, padding: "2px 8px", background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 4, cursor: (cloning || fetchingAll) ? "not-allowed" : "pointer" }}
                title="行をコピー（同一ブランチ内）"
              >
                {(cloning || fetchingAll) ? "コピー中..." : `コピー (${selectedRows.length})`}
              </button>
            )}
            {canEditRows && pkCols.length > 0 && (
              <button
                onClick={() => { setBulkEditTargetRows(selectedRows); setShowBulkEditModal(true); }}
                style={{ fontSize: 11, padding: "2px 8px", background: "#fef9c3", color: "#713f12", border: "1px solid #fde68a", borderRadius: 4, cursor: "pointer" }}
                title="選択行のカラム値を一括置換"
              >
                一括置換 ({selectedRows.length})
              </button>
            )}
            {onCrossCopyRows && (
              <span title={selectedRowsContainDrafts ? crossCopyDisabledReason : "選択行を他のDBにコピー"}>
                <button
                  onClick={() => {
                    const pks = selectedRows.map((r) => rowPkId(r));
                    onCrossCopyRows(pks);
                  }}
                  disabled={pkCols.length === 0 || selectedRowsContainDrafts}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#dbeafe", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, cursor: pkCols.length === 0 || selectedRowsContainDrafts ? "not-allowed" : "pointer" }}
                  title={selectedRowsContainDrafts ? crossCopyDisabledReason : "選択行を他のDBにコピー"}
                >
                  他DBへ{selectedRows.length > 1 ? ` (${selectedRows.length})` : ""}
                </button>
              </span>
            )}
            {canEditRows && (
              <button
                onClick={() => handleDeleteRows(selectedRows)}
                disabled={pkCols.length === 0}
                style={{ fontSize: 11, padding: "2px 8px", background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer" }}
                title="行を削除"
              >
                削除{selectedRows.length > 1 ? ` (${selectedRows.length})` : ""}
              </button>
            )}
            {canEditRows && selectedRows.length === 1 && undoableOpIndex !== null && (
              <button
                onClick={handleUndoRow}
                style={{ fontSize: 11, padding: "2px 8px", background: "#f3f4f6", color: "#4b5563", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer" }}
                title="この行の最新の編集を取り消す"
              >
                ⟲ Undo
              </button>
            )}
          </div>
        )}
        {/* P3/U2: Full-operation buttons — shown when no rows selected but filter is active */}
        {selectedRows.length === 0 && serverFilter !== "" && pkCols.length > 0 && (canEditRows || canCrossCopyRows) && (
          <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
            {canEditRows && (
              <button
                onClick={handleCloneAllFiltered}
                disabled={fetchingAll || cloning || totalCount === 0}
                style={{ fontSize: 11, padding: "2px 8px", background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 4, cursor: fetchingAll || cloning ? "not-allowed" : "pointer" }}
                title="フィルタ結果の全件をコピー（最大 1,000 件）"
              >
                {fetchingAll ? "取得中..." : `全件コピー (${Math.min(totalCount, 1000).toLocaleString()})`}
              </button>
            )}
            {canEditRows && (
              <button
                onClick={handleBulkEditAllFiltered}
                disabled={fetchingAll || totalCount === 0}
                style={{ fontSize: 11, padding: "2px 8px", background: "#fef9c3", color: "#713f12", border: "1px solid #fde68a", borderRadius: 4, cursor: fetchingAll ? "not-allowed" : "pointer" }}
                title="フィルタ結果の全件を一括置換（最大 1,000 件）"
              >
                全件一括置換 ({Math.min(totalCount, 1000).toLocaleString()})
              </button>
            )}
            {onCrossCopyRows && (
              <span title={tableHasDrafts ? crossCopyDisabledReason : "フィルタ結果の全件を他DBへコピー（最大 1,000 件）"}>
                <button
                  onClick={handleCrossCopyAllFiltered}
                  disabled={fetchingAll || totalCount === 0 || tableHasDrafts}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#dbeafe", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, cursor: fetchingAll || totalCount === 0 || tableHasDrafts ? "not-allowed" : "pointer" }}
                  title={tableHasDrafts ? crossCopyDisabledReason : "フィルタ結果の全件を他DBへコピー（最大 1,000 件）"}
                >
                  全件他DBへ ({Math.min(totalCount, 1000).toLocaleString()})
                </button>
              </span>
            )}
            {canEditRows && (
              <button
                onClick={handleDeleteAllFiltered}
                disabled={fetchingAll || totalCount === 0}
                style={{ fontSize: 11, padding: "2px 8px", background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, cursor: fetchingAll ? "not-allowed" : "pointer" }}
                title="フィルタ結果の全件を削除（最大 1,000 件）"
              >
                全件削除 ({Math.min(totalCount, 1000).toLocaleString()})
              </button>
            )}
          </div>
        )}

        {/* 履歴ボタン (読み取り専用 — 保護ブランチ・編集ブロック中でも表示) */}
        {selectedRows.length === 1 && onShowRowHistory && pkCols.length > 0 && (
          <button
            onClick={() => onShowRowHistory(tableName, rowPkId(selectedRows[0]))}
            style={{ fontSize: 11, padding: "2px 8px", background: "#f0f9ff", color: "#0369a1",
                     border: "1px solid #bae6fd", borderRadius: 4, cursor: "pointer" }}
            title="このレコードのマージ履歴を表示"
          >
            履歴
          </button>
        )}

        <ColumnToggle
          columns={columns}
          hiddenColumns={hiddenColumns}
          onToggle={handleColumnToggle}
        />
      </div>

      {/* AG Grid */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <AgGridReact
          ref={gridRef}
          rowData={displayRows}
          columnDefs={colDefs}
          defaultColDef={{
            minWidth: 80,
          }}
          autoSizeStrategy={{ type: "fitCellContents" }}
          rowSelection="multiple"
          enableCellTextSelection={isProtected}
          ensureDomOrder={isProtected}
          suppressRowClickSelection={true}
          getRowId={getRowId}
          onSelectionChanged={onSelectionChanged}
          onFirstDataRendered={onFirstDataRendered}
          onCellValueChanged={onCellValueChanged}
          suppressClickEdit={editingBlocked}
          getContextMenuItems={AG_GRID_CONTEXT_MENU_SUPPORTED ? getContextMenuItems : undefined}
          onCellClicked={onCellClicked}
          onFilterChanged={onFilterChanged}
          onSortChanged={onSortChanged}
          overlayNoRowsTemplate="<span style='font-size:13px;color:#666'>検索条件に一致するデータがありません</span>"
        />
      </div>

      {/* Footer pagination (only when multiple pages) */}
      {showPagination && (
        <div className="toolbar" style={{ justifyContent: "center" }}>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ fontSize: 12 }}>
            ◀
          </button>
          <span style={{ fontSize: 12, color: "#666" }}>
            {page} / {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={{ fontSize: 12 }}>
            ▶
          </button>
        </div>
      )}

      {/* P5: Bulk edit modal */}
      {showBulkEditModal && (
        <BulkEditModal
          columns={columns}
          selectedRows={bulkEditTargetRows}
          onApply={handleBulkEdit}
          onClose={() => setShowBulkEditModal(false)}
        />
      )}
    </div>
  );
}
