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
import { createClientRowId } from "../../utils/clientRowId";
import { previewBulkEdit, type BulkEditOperation } from "../../utils/bulkEdit";
import { UI_CLONE_TIMEOUT_MS } from "../../constants/ui";
import {
  buildRowModel,
  getTableGridPkId,
  getTableGridRowId,
  isDraftInsertRow,
  type TableGridRow,
} from "./rowModel";
import {
  FILTERED_ACTION_PREVIEW_LIMIT,
  buildFilteredActionPreview,
  collectMissingBaseDraftPks,
  getFilteredActionPersistedFetchTargetCount,
  type FilteredActionPreview,
} from "./filteredActionPreview";

ModuleRegistry.registerModules([AllCommunityModule]);
// The toolbar covers row actions in community mode; AG Grid's context menu
// requires an enterprise-only module and otherwise emits console errors.
const AG_GRID_CONTEXT_MENU_SUPPORTED = false;

interface FilteredActionPreviewState extends FilteredActionPreview {
  loading: boolean;
  error: string | null;
}

const EMPTY_FILTERED_ACTION_PREVIEW: FilteredActionPreviewState = {
  rows: [],
  count: 0,
  containsDraftRows: false,
  capped: false,
  loading: false,
  error: null,
};

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
  const [activeFilterJson, setActiveFilterJson] = useState("");
  const [activeSortSpec, setActiveSortSpec] = useState("");
  const [schemaReadyKey, setSchemaReadyKey] = useState<string>("");
  const colVisibilityKey = `colVisibility/${targetId}/${dbName}/${tableName}`;
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    const saved = safeGetJSON<string[]>(localStorage, colVisibilityKey, []);
    return new Set<string>(saved);
  });
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [showDraftOnly, setShowDraftOnly] = useState(false);
  const [commentCells, setCommentCells] = useState<Set<string>>(new Set());
  const [cloning, setCloning] = useState(false);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkEditTargetRows, setBulkEditTargetRows] = useState<Record<string, unknown>[]>([]);
  const [filteredActionPreview, setFilteredActionPreview] = useState<FilteredActionPreviewState>(
    EMPTY_FILTERED_ACTION_PREVIEW
  );
  const cloningRef = useRef(false);
  const gridRef = useRef<AgGridReact>(null);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filteredActionPreviewRequestIdRef = useRef(0);

  // Persist column visibility to localStorage
  useEffect(() => {
    safeSetJSON(localStorage, colVisibilityKey, [...hiddenColumns]);
  }, [hiddenColumns, colVisibilityKey]);

  const isProtected = branchName === "main" || branchName === "audit";
  const baseState = useUIStore((s) => s.baseState);
  const removeOp = useDraftStore((s) => s.removeOp);
  const [undoableOpIndex, setUndoableOpIndex] = useState<number | null>(null);

  const pkCols = useMemo(() => columns.filter((c) => c.primary_key), [columns]);
  const tableDraftOps = useMemo(
    () => draftOps.filter((op) => op.table === tableName),
    [draftOps, tableName]
  );
  /**
   * Stable, canonical row ID: JSON of PK columns sorted alphabetically by key.
   * Sorted order ensures the string is identical regardless of:
   *   - AG Grid data object key insertion order
   *   - Go map iteration order (which is random)
   * Must match the normalization applied server-side when saving pk_value.
   */
  const rowPkId = useCallback(
    (row: Record<string, unknown>) => {
      return getTableGridPkId(row, pkCols);
    },
    [pkCols]
  );

  const stableGridRowId = useCallback(
    (row: Record<string, unknown>) => {
      return getTableGridRowId(row, pkCols);
    },
    [pkCols]
  );

  // Stable row ID for AG Grid selection — sorted PK JSON.
  const getRowId = useMemo(
    () => (params: { data: Record<string, unknown>; rowIndex?: number }) => {
      if (typeof params.data._rowId === "string" && params.data._rowId !== "") {
        return params.data._rowId;
      }
      if (pkCols.length === 0) return `row:${params.rowIndex ?? Math.random()}`;
      return stableGridRowId(params.data);
    },
    [pkCols.length, stableGridRowId]
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
  const canCrossCopyRows = !!onCrossCopyRows;
  const canEditRows = !isProtected && !editingBlocked;
  const fullActionButtonsVisible =
    selectedRowIds.length === 0 && activeFilterJson !== "" && pkCols.length > 0 && (canEditRows || canCrossCopyRows);

  // Draft operations lookup for Undo functionality (only when exactly 1 row selected)
  const {
    displayRows,
    rowById,
    draftStateByRowId,
    duplicatePkRowIds,
  } = useMemo(
    () =>
      buildRowModel({
        baseRows: rowData,
        draftOps: tableDraftOps,
        pkCols,
        tableName,
        filterJson: activeFilterJson,
        sortSpec: activeSortSpec,
        showDraftOnly,
      }),
    [rowData, tableDraftOps, pkCols, tableName, activeFilterJson, activeSortSpec, showDraftOnly]
  );
  const selectedDisplayRows = useMemo(
    () =>
      selectedRowIds
        .map((rowId) => rowById.get(rowId))
        .filter((row): row is TableGridRow => row != null),
    [selectedRowIds, rowById]
  );
  const selectedRowIdSet = useMemo(() => new Set(selectedRowIds), [selectedRowIds]);
  const effectiveSelectedRow = selectedDisplayRows.length === 1 ? selectedDisplayRows[0] : null;

  useEffect(() => {
    setDuplicatePkCount(duplicatePkRowIds.size);
  }, [duplicatePkRowIds.size, setDuplicatePkCount]);

  useEffect(() => {
    if (tableDraftOps.length > 0) return;
    setShowDraftOnly(false);
    setSelectedRowIds([]);
    setBulkEditTargetRows([]);
  }, [tableDraftOps.length]);

  useEffect(() => {
    setSelectedRowIds((prev) => {
      const next = prev.filter((rowId) => rowById.has(rowId));
      return next.length === prev.length ? prev : next;
    });
  }, [rowById]);

  useEffect(() => {
    const gridApi = gridRef.current?.api;
    if (!gridApi) return;
    gridApi.forEachNode((node) => {
      const shouldSelect = node.id != null && selectedRowIdSet.has(node.id);
      if (node.isSelected() !== shouldSelect) {
        node.setSelected(shouldSelect);
      }
    });
  }, [displayRows, selectedRowIdSet]);

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
      if (op.table !== tableName) continue;
      if (isDraftInsertRow(effectiveSelectedRow)) {
        if (op.client_row_id && op.client_row_id === effectiveSelectedRow._clientRowId) {
          foundIdx = i;
          break;
        }
        continue;
      }
      if (op.pk && stablePkJson(op.pk) === rowId) {
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

  // Load schema
  useEffect(() => {
    if (!tableName) return;
    let cancelled = false;
    const currentSchemaKey = `${tableName}|${effectiveRef}`;
    setGridError(null);
    setSchemaReadyKey("");        // ガード ON: loadRows をブロック
    setServerFilter("");          // フィルタリセット
    setServerSort("");            // ソートリセット
    setActiveFilterJson("");      // ローカルフィルタもリセット
    setActiveSortSpec("");        // ローカルソートもリセット
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
        setSelectedRowIds([]);
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

  useEffect(() => {
    if (!fullActionButtonsVisible || !tableName || schemaReadyKey !== `${tableName}|${effectiveRef}`) {
      setFilteredActionPreview(EMPTY_FILTERED_ACTION_PREVIEW);
      return;
    }

    const requestId = ++filteredActionPreviewRequestIdRef.current;
    let cancelled = false;
    setFilteredActionPreview({
      ...EMPTY_FILTERED_ACTION_PREVIEW,
      loading: true,
    });

    void (async () => {
      try {
        const persistedRows: Record<string, unknown>[] = [];
        let serverTotalCount = 0;
        let pageNum = 1;

        while (true) {
          const res = await api.getTableRows(
            targetId,
            dbName,
            effectiveRef,
            tableName,
            pageNum,
            FILTERED_ACTION_PREVIEW_LIMIT,
            activeFilterJson,
            activeSortSpec,
          );
          if (cancelled || filteredActionPreviewRequestIdRef.current !== requestId) return;

          if (pageNum === 1) {
            serverTotalCount = res.total_count;
          }

          const nextRows = res.rows || [];
          persistedRows.push(...nextRows);

          const targetPersistedCount = getFilteredActionPersistedFetchTargetCount(
            persistedRows,
            tableDraftOps,
            pkCols,
            tableName,
            serverTotalCount,
          );
          const exhaustedRows = nextRows.length === 0 || persistedRows.length >= serverTotalCount;
          if (persistedRows.length >= targetPersistedCount || exhaustedRows) {
            break;
          }

          pageNum += 1;
        }

        const missingPks = collectMissingBaseDraftPks(persistedRows, tableDraftOps, pkCols, tableName);
        const fetchedDraftBaseRows = (
          await Promise.all(
            missingPks.map(async (pk) => {
              try {
                return await api.getTableRow(
                  targetId,
                  dbName,
                  effectiveRef,
                  tableName,
                  stablePkJson(pk),
                );
              } catch (err: unknown) {
                if (err instanceof ApiError && err.status === 404) {
                  return null;
                }
                throw err;
              }
            })
          )
        ).filter((row): row is Record<string, unknown> => row != null);
        if (cancelled || filteredActionPreviewRequestIdRef.current !== requestId) return;

        const preview = buildFilteredActionPreview({
          persistedRows,
          fetchedDraftBaseRows,
          draftOps: tableDraftOps,
          pkCols,
          tableName,
          filterJson: activeFilterJson,
          sortSpec: activeSortSpec,
          showDraftOnly,
          serverTotalCount,
        });
        setFilteredActionPreview({
          ...preview,
          loading: false,
          error: null,
        });
      } catch (err: unknown) {
        if (cancelled || filteredActionPreviewRequestIdRef.current !== requestId) return;
        const msg = err instanceof ApiError ? err.message : "表示中結果の取得に失敗しました";
        setFilteredActionPreview({
          ...EMPTY_FILTERED_ACTION_PREVIEW,
          loading: false,
          error: msg,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    fullActionButtonsVisible,
    tableName,
    schemaReadyKey,
    effectiveRef,
    targetId,
    dbName,
    activeFilterJson,
    activeSortSpec,
    showDraftOnly,
    tableDraftOps,
    pkCols,
  ]);

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

  // Selection changed handler
  const onSelectionChanged = useCallback((event: SelectionChangedEvent) => {
    const nextRowIds = event.api
      .getSelectedNodes()
      .map((node) => node.id)
      .filter((rowId): rowId is string => !!rowId);
    setSelectedRowIds(nextRowIds);
  }, []);

  // --- Shared action functions (used by both right-click menu and toolbar buttons) ---

  // Cell click handler — notifies parent of selected cell for comment panel
  const onCellClicked = useCallback((event: CellClickedEvent) => {
    if (!onCellSelected || pkCols.length === 0 || !event.data) {
      onCellSelected?.(null);
      return;
    }
    if (isDraftInsertRow(event.data as Record<string, unknown>)) {
      onCellSelected(null);
      return;
    }
    const colName = event.column.getColDef().field ?? "";
    // pk is JSON of all PK columns for composite PK support
    const pkVal = rowPkId(event.data as Record<string, unknown>);
    onCellSelected({ table: tableName, pk: pkVal, column: colName });
  }, [onCellSelected, pkCols, rowPkId, tableName]);

  const rowHasDraft = useCallback((row: Record<string, unknown>) => {
    if (isDraftInsertRow(row)) return true;
    const rowId = stableGridRowId(row);
    if (rowId !== "" && draftStateByRowId.has(rowId)) return true;
    if (pkCols.length === 0) return false;
    const pkId = rowPkId(row);
    return tableDraftOps.some(
      (op) => op.table === tableName && !op.client_row_id && op.pk != null && stablePkJson(op.pk) === pkId
    );
  }, [draftStateByRowId, stableGridRowId, pkCols.length, rowPkId, tableDraftOps, tableName]);

  const selectedRowsContainDrafts = useMemo(
    () => selectedDisplayRows.some((row) => rowHasDraft(row)),
    [rowHasDraft, selectedDisplayRows]
  );
  const copyDisabledReason = "未コミット変更を含む行はコピーできません。先にCommitするか、変更をクリアしてください。";
  const crossCopyDisabledReason = "未コミット変更は他DBコピーに含まれません。先にCommitするか、変更をクリアしてください。";

  const handleCloneRows = useCallback(async (rows: Record<string, unknown>[]) => {
    if (pkCols.length === 0 || cloningRef.current) return;
    if (rows.some((row) => rowHasDraft(row))) {
      useUIStore.getState().setError(copyDisabledReason);
      return;
    }
    cloningRef.current = true;
    setCloning(true);
    const clonedRowIds: string[] = [];

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
              if (op.type === "insert") {
                const clientRowId = createClientRowId();
                addOp({ ...op, client_row_id: clientRowId });
                clonedRowIds.push(`draft:${clientRowId}`);
              } else {
                addOp(op);
              }
            }
            setBaseState("DraftEditing");
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
      if (clonedRowIds.length > 0) {
        setSelectedRowIds(clonedRowIds);
      }
    } finally {
      clearTimeout(timeoutId);
      cloningRef.current = false;
      setCloning(false);
    }
  }, [pkCols, rowHasDraft, copyDisabledReason, tableName, targetId, dbName, branchName, addOp, setBaseState]);

  const handleDeleteRows = useCallback((rows: Record<string, unknown>[]) => {
    if (pkCols.length === 0) return;
    for (const row of rows) {
      const pk = Object.fromEntries(pkCols.map((c) => [c.name, row[c.name]]));
      addOp({
        type: "delete",
        table: tableName,
        values: {},
        pk,
        ...(typeof row._clientRowId === "string" ? { client_row_id: row._clientRowId } : {}),
      });
    }
    setBaseState("DraftEditing");
  }, [pkCols, tableName, addOp, setBaseState]);

  // P5: 一括置換 — 選択行の任意カラムを一括適用
  const handleBulkEdit = useCallback(
    (column: string, operation: BulkEditOperation) => {
      if (pkCols.length === 0) return;
      const targetRows = bulkEditTargetRows;
      const changedRowIds: string[] = [];
      for (const row of targetRows) {
        const preview = previewBulkEdit(row[column], operation);
        if (!preview.willChange) {
          continue;
        }
        const pk = Object.fromEntries(pkCols.map((c) => [c.name, row[c.name]]));
        const nextRowId = isDraftInsertRow(row)
          ? stableGridRowId(row)
          : getTableGridRowId({ ...row, [column]: preview.newStr }, pkCols);
        addOp({
          type: "update",
          table: tableName,
          values: { [column]: preview.newStr },
          pk,
          ...(typeof row._clientRowId === "string" ? { client_row_id: row._clientRowId } : {}),
        });
        changedRowIds.push(nextRowId || stableGridRowId(row));
      }
      if (changedRowIds.length > 0) {
        setSelectedRowIds(changedRowIds);
      }
      setBaseState("DraftEditing");
    },
    [bulkEditTargetRows, tableName, pkCols, addOp, setBaseState, stableGridRowId]
  );

  const filteredActionTargetRows = filteredActionPreview.rows;
  const filteredActionTargetCount = filteredActionPreview.count;
  const filteredActionRowsContainDrafts = filteredActionPreview.containsDraftRows;
  const filteredActionDisabledReason = filteredActionPreview.error
    ?? (filteredActionPreview.loading ? "表示中結果を再計算中です。" : null);

  const confirmFilteredActionTarget = useCallback((): Record<string, unknown>[] | null => {
    if (filteredActionDisabledReason) {
      useUIStore.getState().setError(filteredActionDisabledReason);
      return null;
    }
    if (filteredActionTargetCount === 0) {
      return null;
    }
    const msg = filteredActionPreview.capped
      ? `表示結果は 1,000 件を超えるため、先頭 ${FILTERED_ACTION_PREVIEW_LIMIT.toLocaleString()} 件のみ対象です。続けますか？`
      : `表示結果の ${filteredActionTargetCount.toLocaleString()} 件を対象にします。続けますか？`;
    if (!window.confirm(msg)) return null;
    return filteredActionTargetRows;
  }, [filteredActionDisabledReason, filteredActionTargetCount, filteredActionTargetRows, filteredActionPreview.capped]);

  // Feature 2: Clone all rows matching the current server filter (up to 1000)
  const handleCloneAllFiltered = useCallback(async () => {
    const rows = confirmFilteredActionTarget();
    if (!rows) return;
    await handleCloneRows(rows);
  }, [confirmFilteredActionTarget, handleCloneRows]);

  // U2: Bulk edit all filtered rows
  const handleBulkEditAllFiltered = useCallback(() => {
    const rows = confirmFilteredActionTarget();
    if (!rows) return;
    setBulkEditTargetRows(rows);
    setShowBulkEditModal(true);
  }, [confirmFilteredActionTarget]);

  // U2: Delete all filtered rows
  const handleDeleteAllFiltered = useCallback(() => {
    const rows = confirmFilteredActionTarget();
    if (!rows) return;
    if (!window.confirm(`${rows.length} 件を削除します。この操作は取り消せません。続けますか？`)) return;
    handleDeleteRows(rows);
  }, [confirmFilteredActionTarget, handleDeleteRows]);

  // U2: Cross-copy all filtered rows
  const handleCrossCopyAllFiltered = useCallback(() => {
    if (!onCrossCopyRows || filteredActionRowsContainDrafts) return;
    const rows = confirmFilteredActionTarget();
    if (!rows) return;
    const pks = rows.map((r) => rowPkId(r));
    onCrossCopyRows(pks);
  }, [confirmFilteredActionTarget, onCrossCopyRows, rowPkId, filteredActionRowsContainDrafts]);

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
      const isInSelection = selectedRowIdSet.has(stableGridRowId(rowNode));
      const targetRows = isInSelection && selectedDisplayRows.length > 1 ? selectedDisplayRows : [rowNode];
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
        disabled: pkCols.length === 0 || targetRowsContainDrafts,
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
    [isProtected, editingBlocked, canCrossCopyRows, pkCols.length, selectedRowIdSet, selectedDisplayRows, stableGridRowId, rowPkId, handleCloneRows, handleDeleteRows, onCrossCopyRows, rowHasDraft]
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
    setActiveFilterJson(newFilter);
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
    setActiveSortSpec(newSort);
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
        const rowData = params.data as Record<string, unknown>;
        const rowId = stableGridRowId(rowData);
        const draft = draftStateByRowId.get(rowId);

        if (draft) {
          // Row-level draft markers
          if (draft.type === "insert") {
            if (duplicatePkRowIds.has(rowId)) {
              return { ...base, backgroundColor: "#ffedd5", ...(col === visibleCols[0] ? { borderLeft: "3px solid #ea580c" } : {}) };
            }
            return { ...base, backgroundColor: "#dcfce7", ...(col === visibleCols[0] ? { borderLeft: "3px solid #16a34a" } : {}) };
          }
          if (draft.type === "delete") {
            return { ...base, backgroundColor: "#fee2e2", textDecoration: "line-through", color: "#888", ...(col === visibleCols[0] ? { borderLeft: "3px solid #dc2626" } : {}) };
          }
          if (draft.type === "update") {
            if (draft.changedCols.has(col.name)) {
              return { ...base, backgroundColor: "#fef3c7", fontWeight: "600", ...(col === visibleCols[0] ? { borderLeft: "3px solid #f59e0b" } : {}) };
            }
            if (col === visibleCols[0]) {
              return { ...base, borderLeft: "3px solid #f59e0b" };
            }
          }
        }

        if (isDraftInsertRow(rowData)) return base;

        const cellKey = `${rowPkId(rowData)}:${col.name}`;

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
  }, [columns, hiddenColumns, editingBlocked, draftStateByRowId, duplicatePkRowIds, commentCells, rowPkId, stableGridRowId]);


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
        ...(typeof event.data?._clientRowId === "string"
          ? { client_row_id: event.data._clientRowId }
          : {}),
      });
      setBaseState("DraftEditing");
    },
    [pkCols, tableName, addOp, setBaseState]
  );


  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const showPagination = !showDraftOnly && totalPages > 1;
  const rowCountLabel = displayRows.length === totalCount
    ? `${displayRows.length.toLocaleString()} rows`
    : `表示 ${displayRows.length.toLocaleString()} / DB ${totalCount.toLocaleString()} rows`;
  const canShowRowHistory =
    selectedDisplayRows.length === 1 &&
    effectiveSelectedRow != null &&
    !isDraftInsertRow(effectiveSelectedRow);
  const filteredActionCountLabel = filteredActionTargetCount.toLocaleString();
  const filteredActionTargetTitle = filteredActionPreview.capped
    ? `表示中結果の先頭 ${FILTERED_ACTION_PREVIEW_LIMIT.toLocaleString()} 件を対象にします`
    : `表示中結果の ${filteredActionTargetCount.toLocaleString()} 件を対象にします`;
  const selectedCopyButtonTitle = selectedRowsContainDrafts
    ? copyDisabledReason
    : "行をコピー（同一ブランチ内）";
  const filteredCopyButtonTitle = filteredActionDisabledReason
    ?? (filteredActionRowsContainDrafts ? copyDisabledReason : `${filteredActionTargetTitle} をコピーします`);
  const filteredCrossCopyButtonTitle = filteredActionDisabledReason
    ?? (filteredActionRowsContainDrafts ? crossCopyDisabledReason : `${filteredActionTargetTitle} を他DBへコピーします`);
  const filteredBulkEditButtonTitle = filteredActionDisabledReason
    ?? `${filteredActionTargetTitle} を一括置換します`;
  const filteredDeleteButtonTitle = filteredActionDisabledReason
    ?? `${filteredActionTargetTitle} を削除します`;

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
          {rowCountLabel} {loading && "• Loading..."}
        </span>

        {/* P2: Draft-only toggle — visible when draft ops exist */}
        {!editingBlocked && tableDraftOps.length > 0 && (
          <button
            onClick={() => setShowDraftOnly((v) => !v)}
            style={{ fontSize: 11, padding: "2px 8px", background: showDraftOnly ? "#fef9c3" : "#f3f4f6", color: showDraftOnly ? "#713f12" : "#4b5563", border: `1px solid ${showDraftOnly ? "#fde68a" : "#d1d5db"}`, borderRadius: 4, cursor: "pointer" }}
            title="ドラフト行のみ表示"
          >
            📝 ドラフトのみ
          </button>
        )}

        {/* Row action buttons (visible when 1+ rows are selected and not blocked) */}
        {selectedDisplayRows.length > 0 && (canEditRows || canCrossCopyRows) && (
          <div style={{ display: "flex", gap: 2, alignItems: "center", marginRight: 8 }}>
            {/* P3: Unified copy button — selected rows take priority over filter */}
            {canEditRows && pkCols.length > 0 && (
              <span title={selectedCopyButtonTitle}>
                <button
                  onClick={() => handleCloneRows(selectedDisplayRows)}
                  disabled={cloning || selectedRowsContainDrafts}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 4, cursor: (cloning || selectedRowsContainDrafts) ? "not-allowed" : "pointer" }}
                  title={selectedCopyButtonTitle}
                >
                  {cloning ? "コピー中..." : `コピー (${selectedDisplayRows.length})`}
                </button>
              </span>
            )}
            {canEditRows && pkCols.length > 0 && (
              <button
                onClick={() => { setBulkEditTargetRows(selectedDisplayRows); setShowBulkEditModal(true); }}
                style={{ fontSize: 11, padding: "2px 8px", background: "#fef9c3", color: "#713f12", border: "1px solid #fde68a", borderRadius: 4, cursor: "pointer" }}
                title="選択行のカラム値を一括置換"
              >
                一括置換 ({selectedDisplayRows.length})
              </button>
            )}
            {onCrossCopyRows && (
              <span title={selectedRowsContainDrafts ? crossCopyDisabledReason : "選択行を他のDBにコピー"}>
                <button
                  onClick={() => {
                    const pks = selectedDisplayRows.map((r) => rowPkId(r));
                    onCrossCopyRows(pks);
                  }}
                  disabled={pkCols.length === 0 || selectedRowsContainDrafts}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#dbeafe", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, cursor: pkCols.length === 0 || selectedRowsContainDrafts ? "not-allowed" : "pointer" }}
                  title={selectedRowsContainDrafts ? crossCopyDisabledReason : "選択行を他のDBにコピー"}
                >
                  他DBへ{selectedDisplayRows.length > 1 ? ` (${selectedDisplayRows.length})` : ""}
                </button>
              </span>
            )}
            {canEditRows && (
              <button
                onClick={() => handleDeleteRows(selectedDisplayRows)}
                disabled={pkCols.length === 0}
                style={{ fontSize: 11, padding: "2px 8px", background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer" }}
                title="行を削除"
              >
                削除{selectedDisplayRows.length > 1 ? ` (${selectedDisplayRows.length})` : ""}
              </button>
            )}
            {canEditRows && selectedDisplayRows.length === 1 && undoableOpIndex !== null && (
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
        {selectedDisplayRows.length === 0 && activeFilterJson !== "" && pkCols.length > 0 && (canEditRows || canCrossCopyRows) && (
          <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
            {canEditRows && (
              <span title={filteredCopyButtonTitle}>
                <button
                  onClick={handleCloneAllFiltered}
                  disabled={filteredActionPreview.loading || cloning || filteredActionDisabledReason != null || filteredActionTargetCount === 0 || filteredActionRowsContainDrafts}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 4, cursor: filteredActionPreview.loading || cloning || filteredActionDisabledReason != null || filteredActionTargetCount === 0 || filteredActionRowsContainDrafts ? "not-allowed" : "pointer" }}
                  title={filteredCopyButtonTitle}
                >
                  {filteredActionPreview.loading ? "集計中..." : `全件コピー (${filteredActionCountLabel})`}
                </button>
              </span>
            )}
            {canEditRows && (
              <span title={filteredBulkEditButtonTitle}>
                <button
                  onClick={handleBulkEditAllFiltered}
                  disabled={filteredActionPreview.loading || filteredActionDisabledReason != null || filteredActionTargetCount === 0}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#fef9c3", color: "#713f12", border: "1px solid #fde68a", borderRadius: 4, cursor: filteredActionPreview.loading || filteredActionDisabledReason != null || filteredActionTargetCount === 0 ? "not-allowed" : "pointer" }}
                  title={filteredBulkEditButtonTitle}
                >
                  {filteredActionPreview.loading ? "集計中..." : `全件一括置換 (${filteredActionCountLabel})`}
                </button>
              </span>
            )}
            {onCrossCopyRows && (
              <span title={filteredCrossCopyButtonTitle}>
                <button
                  onClick={handleCrossCopyAllFiltered}
                  disabled={filteredActionPreview.loading || filteredActionDisabledReason != null || filteredActionTargetCount === 0 || filteredActionRowsContainDrafts}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#dbeafe", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 4, cursor: filteredActionPreview.loading || filteredActionDisabledReason != null || filteredActionTargetCount === 0 || filteredActionRowsContainDrafts ? "not-allowed" : "pointer" }}
                  title={filteredCrossCopyButtonTitle}
                >
                  {filteredActionPreview.loading ? "集計中..." : `全件他DBへ (${filteredActionCountLabel})`}
                </button>
              </span>
            )}
            {canEditRows && (
              <span title={filteredDeleteButtonTitle}>
                <button
                  onClick={handleDeleteAllFiltered}
                  disabled={filteredActionPreview.loading || filteredActionDisabledReason != null || filteredActionTargetCount === 0}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, cursor: filteredActionPreview.loading || filteredActionDisabledReason != null || filteredActionTargetCount === 0 ? "not-allowed" : "pointer" }}
                  title={filteredDeleteButtonTitle}
                >
                  {filteredActionPreview.loading ? "集計中..." : `全件削除 (${filteredActionCountLabel})`}
                </button>
              </span>
            )}
          </div>
        )}

        {/* 履歴ボタン (読み取り専用 — 保護ブランチ・編集ブロック中でも表示) */}
        {canShowRowHistory && onShowRowHistory && pkCols.length > 0 && effectiveSelectedRow && (
          <button
            onClick={() => onShowRowHistory(tableName, rowPkId(effectiveSelectedRow))}
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
