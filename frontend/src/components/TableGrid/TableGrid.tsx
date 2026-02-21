import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type RowClickedEvent,
} from "ag-grid-community";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import { RecordHistoryPopup } from "../common/RecordHistoryPopup";
import { BatchGenerateModal } from "../BatchGenerateModal/BatchGenerateModal";
import * as api from "../../api/client";
import type { ColumnSchema, RowsResponse } from "../../types/api";

ModuleRegistry.registerModules([AllCommunityModule]);

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
interface TableGridProps {
  tableName: string;
  refreshKey?: number;
}

export function TableGrid({ tableName, refreshKey }: TableGridProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const addOp = useDraftStore((s) => s.addOp);
  const draftOps = useDraftStore((s) => s.ops);
  const setBaseState = useUIStore((s) => s.setBaseState);

  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [rowData, setRowData] = useState<Record<string, unknown>[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [serverFilter, setServerFilter] = useState("");
  const [serverSort, setServerSort] = useState("");
  const colVisibilityKey = `colVisibility/${targetId}/${dbName}/${tableName}`;
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(`colVisibility/${targetId}/${dbName}/${tableName}`);
      return saved ? new Set<string>(JSON.parse(saved) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const [historyTarget, setHistoryTarget] = useState<{ pkJson: string; pkLabel: string } | null>(null);
  const [batchGenerateConfig, setBatchGenerateConfig] = useState<{
    templateRow: Record<string, unknown>;
    changeColumn?: string;
  } | null>(null);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const gridRef = useRef<AgGridReact>(null);

  // Persist column visibility to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(colVisibilityKey, JSON.stringify([...hiddenColumns]));
    } catch { /* ignore */ }
  }, [hiddenColumns, colVisibilityKey]);

  const isMain = branchName === "main";
  const baseState = useUIStore((s) => s.baseState);

  // Editing is only allowed in Idle or DraftEditing states on non-main branches
  const editingBlocked =
    isMain ||
    baseState === "Committing" ||
    baseState === "Syncing" ||
    baseState === "MergeConflictsPresent" ||
    baseState === "SchemaConflictDetected" ||
    baseState === "ConstraintViolationDetected" ||
    baseState === "StaleHeadDetected";

  // Build draft index for visualization:
  // Map of pkValue -> { type, changedCols }
  const draftIndex = useMemo(() => {
    const pkCol = columns.find((c) => c.primary_key);
    if (!pkCol) return new Map<string, { type: string; changedCols: Set<string> }>();

    const index = new Map<string, { type: string; changedCols: Set<string> }>();
    for (const op of draftOps) {
      if (op.table !== tableName) continue;
      const pkVal = op.type === "insert"
        ? String(op.values[pkCol.name])
        : String(op.pk?.[pkCol.name]);
      const existing = index.get(pkVal);
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
        index.set(pkVal, { type: op.type, changedCols });
      }
    }
    return index;
  }, [draftOps, tableName, columns]);

  // Load schema
  useEffect(() => {
    if (!tableName) return;
    api
      .getTableSchema(targetId, dbName, branchName, tableName)
      .then((schema) => {
        setColumns(schema.columns);
        setHiddenColumns(new Set());
        setSelectedRow(null);
      })
      .catch(console.error);
  }, [targetId, dbName, branchName, tableName]);

  // Load rows (server-side filter + sort)
  const loadRows = useCallback(() => {
    if (!tableName) return;
    setLoading(true);
    api
      .getTableRows(targetId, dbName, branchName, tableName, page, pageSize, serverFilter, serverSort)
      .then((res: RowsResponse) => {
        setRowData(res.rows || []);
        setTotalCount(res.total_count);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [targetId, dbName, branchName, tableName, page, pageSize, serverFilter, serverSort, refreshKey]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  // Optimistic row insert (used after clone)
  const onRowInserted = useCallback((row: Record<string, unknown>) => {
    setRowData((prev) => [...prev, row]);
    setTotalCount((c) => c + 1);
  }, []);

  // Row click handler
  const onRowClicked = useCallback((event: RowClickedEvent) => {
    setSelectedRow(event.data as Record<string, unknown> | null);
  }, []);

  // --- Shared action functions (used by both right-click menu and toolbar buttons) ---
  const pkCol = useMemo(() => columns.find((c) => c.primary_key), [columns]);

  const handleShowHistory = useCallback((row: Record<string, unknown>) => {
    if (!pkCol) return;
    const pkVal = row[pkCol.name];
    setHistoryTarget({
      pkJson: JSON.stringify({ [pkCol.name]: pkVal }),
      pkLabel: String(pkVal),
    });
  }, [pkCol]);

  const handleCloneRow = useCallback(async (row: Record<string, unknown>) => {
    if (!pkCol) return;
    const currentDraftOps = useDraftStore.getState().ops;
    const existingPKs = rowData.map((r) => Number(r[pkCol.name])).filter((n) => !isNaN(n));
    const draftPKs = currentDraftOps
      .filter((op) => op.table === tableName && op.type === "insert" && op.values[pkCol.name] != null)
      .map((op) => Number(op.values[pkCol.name]))
      .filter((n) => !isNaN(n));
    const maxPK = Math.max(0, ...existingPKs, ...draftPKs);
    const newPK = maxPK + 1;

    try {
      const result = await api.previewClone({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        table: tableName,
        template_pk: { [pkCol.name]: row[pkCol.name] },
        new_pks: [newPK],
      });
      if (result.errors?.length > 0) {
        useUIStore.getState().setError(result.errors[0].message);
      } else {
        for (const op of result.ops) {
          addOp(op);
        }
        setBaseState("DraftEditing");
        const insertOp = result.ops.find((op: { type: string }) => op.type === "insert");
        if (insertOp) {
          onRowInserted(insertOp.values as Record<string, unknown>);
        }
      }
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      useUIStore.getState().setError(e?.error?.message || "コピーに失敗しました");
    }
  }, [pkCol, rowData, tableName, targetId, dbName, branchName, addOp, setBaseState, onRowInserted]);

  const handleBatchClone = useCallback((row: Record<string, unknown>, changeColumn?: string) => {
    setBatchGenerateConfig({ templateRow: row, changeColumn });
  }, []);

  const handleDeleteRow = useCallback((row: Record<string, unknown>) => {
    if (!pkCol) return;
    const pkVal = row[pkCol.name];
    addOp({
      type: "delete",
      table: tableName,
      values: {},
      pk: { [pkCol.name]: pkVal },
    });
    setBaseState("DraftEditing");
  }, [pkCol, tableName, addOp, setBaseState]);

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

      const historyItem: MenuItemDef = {
        name: "履歴を表示",
        action: () => handleShowHistory(rowNode),
        disabled: !pkCol,
      };

      if (isMain || editingBlocked) {
        return [historyItem, "separator" as unknown as MenuItemDef, "copy" as unknown as MenuItemDef];
      }

      const cloneItem: MenuItemDef = {
        name: "行をコピー（PK自動採番）",
        action: () => handleCloneRow(rowNode),
      };

      const batchCloneItem: MenuItemDef = {
        name: "一括コピー...",
        action: () => handleBatchClone(rowNode, params.column?.getColDef().field),
      };

      const deleteItem: MenuItemDef = {
        name: "行を削除",
        action: () => handleDeleteRow(rowNode),
        disabled: !pkCol,
        cssClasses: ["ag-menu-option-danger"],
      };

      return [
        historyItem,
        "separator" as unknown as MenuItemDef,
        cloneItem,
        batchCloneItem,
        deleteItem,
        "separator" as unknown as MenuItemDef,
        "copy" as unknown as MenuItemDef,
      ];
    },
    [isMain, editingBlocked, pkCol, handleShowHistory, handleCloneRow, handleBatchClone, handleDeleteRow]
  );

  // Convert AG Grid filter model to backend FilterCondition[] JSON
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
    setServerFilter(conditions.length > 0 ? JSON.stringify(conditions) : "");
    setPage(1);
  }, []);

  // Convert AG Grid sort model to backend sort string
  const onSortChanged = useCallback((event: SortChangedEvent) => {
    const sortModel = event.api.getColumnState()
      .filter((c) => c.sort)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    const parts = sortModel.map((c) =>
      c.sort === "desc" ? `-${c.colId}` : c.colId
    );
    setServerSort(parts.join(","));
    setPage(1);
  }, []);

  // Column definitions for AG Grid with draft visualization
  const colDefs: ColDef[] = useMemo(() => {
    const pkCol = columns.find((c) => c.primary_key);
    const visibleCols = columns.filter((col) => !hiddenColumns.has(col.name));

    return visibleCols.map((col) => ({
      field: col.name,
      headerName: col.name,
      editable: !editingBlocked && !col.primary_key,
      sortable: true,
      filter: true,
      resizable: true,
      cellStyle: (params: CellClassParams) => {
        // PK column always has a subtle bg
        const base: Record<string, string> = col.primary_key
          ? { backgroundColor: "#f0f0f5", fontWeight: "600" }
          : {};

        if (!pkCol || !params.data) return base;
        const pkVal = String(params.data[pkCol.name]);
        const draft = draftIndex.get(pkVal);
        if (!draft) return base;

        // Row-level draft markers
        if (draft.type === "insert") {
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
        return base;
      },
    }));
  }, [columns, hiddenColumns, editingBlocked, draftIndex]);

  // Auto-size columns to fit content on first data render
  const onFirstDataRendered = useCallback((event: FirstDataRenderedEvent) => {
    event.api.autoSizeAllColumns();
  }, []);

  // Handle cell edit
  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      const pkCol = columns.find((c) => c.primary_key);
      if (!pkCol) return;

      const pkValue = event.data[pkCol.name];
      const changedCol = event.colDef.field;
      if (!changedCol) return;

      addOp({
        type: "update",
        table: tableName,
        values: { [changedCol]: event.newValue },
        pk: { [pkCol.name]: pkValue },
      });
      setBaseState("DraftEditing");
    },
    [columns, tableName, addOp, setBaseState]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const showPagination = totalPages > 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toolbar: row info + action buttons + column toggle */}
      <div style={{ display: "flex", alignItems: "center", padding: "2px 8px", background: "#fafafa", borderBottom: "1px solid #e8e8f0", flexShrink: 0, gap: 4 }}>
        <span style={{ fontSize: 11, color: "#888", marginRight: "auto" }}>
          {totalCount.toLocaleString()} rows {loading && "• Loading..."}
        </span>

        {/* Row action buttons (visible when a row is selected) */}
        {selectedRow && (
          <div style={{ display: "flex", gap: 2, alignItems: "center", marginRight: 8 }}>
            <button
              onClick={() => handleShowHistory(selectedRow)}
              disabled={!pkCol}
              style={{ fontSize: 11, padding: "2px 8px", background: "#e0e7ff", color: "#3730a3", border: "1px solid #c7d2fe", borderRadius: 4, cursor: "pointer" }}
              title="履歴を表示"
            >
              履歴
            </button>
            {!editingBlocked && (
              <>
                <button
                  onClick={() => handleCloneRow(selectedRow)}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 4, cursor: "pointer" }}
                  title="行をコピー（PK自動採番）"
                >
                  コピー
                </button>
                <button
                  onClick={() => handleBatchClone(selectedRow)}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 4, cursor: "pointer" }}
                  title="一括コピー"
                >
                  一括
                </button>
                <button
                  onClick={() => handleDeleteRow(selectedRow)}
                  disabled={!pkCol}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer" }}
                  title="行を削除"
                >
                  削除
                </button>
              </>
            )}
          </div>
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
          rowData={rowData}
          columnDefs={colDefs}
          defaultColDef={{
            minWidth: 80,
          }}
          autoSizeStrategy={{ type: "fitCellContents" }}
          onFirstDataRendered={onFirstDataRendered}
          onCellValueChanged={onCellValueChanged}
          suppressClickEdit={editingBlocked}
          getContextMenuItems={getContextMenuItems}
          onRowClicked={onRowClicked}
          onFilterChanged={onFilterChanged}
          onSortChanged={onSortChanged}
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

      {historyTarget && (
        <RecordHistoryPopup
          table={tableName}
          pkJson={historyTarget.pkJson}
          pkLabel={historyTarget.pkLabel}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {batchGenerateConfig && (
        <BatchGenerateModal
          templateRow={batchGenerateConfig.templateRow}
          templateTable={tableName}
          templateColumns={columns}
          changeColumn={batchGenerateConfig.changeColumn}
          onClose={() => setBatchGenerateConfig(null)}
        />
      )}
    </div>
  );
}
