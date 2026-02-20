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
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [historyTarget, setHistoryTarget] = useState<{ pkJson: string; pkLabel: string } | null>(null);
  const [batchGenerateConfig, setBatchGenerateConfig] = useState<{
    templateRow: Record<string, unknown>;
    changeColumn?: string;
  } | null>(null);
  const gridRef = useRef<AgGridReact>(null);

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
      })
      .catch(console.error);
  }, [targetId, dbName, branchName, tableName]);

  // Load rows
  const loadRows = useCallback(() => {
    if (!tableName) return;
    setLoading(true);
    api
      .getTableRows(targetId, dbName, branchName, tableName, page, pageSize)
      .then((res: RowsResponse) => {
        setRowData(res.rows || []);
        setTotalCount(res.total_count);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [targetId, dbName, branchName, tableName, page, pageSize, refreshKey]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  // Optimistic row insert (used after clone)
  const onRowInserted = useCallback((row: Record<string, unknown>) => {
    setRowData((prev) => [...prev, row]);
    setTotalCount((c) => c + 1);
  }, []);

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

  // Right-click context menu
  const getContextMenuItems = useCallback(
    (params: GetContextMenuItemsParams) => {
      if (!params.node || !params.node.data) {
        return ["copy" as unknown as MenuItemDef];
      }

      const rowNode = params.node.data as Record<string, unknown>;
      const pkCol = columns.find((c) => c.primary_key);

      // "Show History" is always available
      const historyItem: MenuItemDef = {
        name: "Show History",
        action: () => {
          if (!pkCol) return;
          const pkVal = rowNode[pkCol.name];
          setHistoryTarget({
            pkJson: JSON.stringify({ [pkCol.name]: pkVal }),
            pkLabel: String(pkVal),
          });
        },
        disabled: !pkCol,
      };

      if (isMain || editingBlocked) {
        return [historyItem, "separator" as unknown as MenuItemDef, "copy" as unknown as MenuItemDef];
      }

      const cloneItem: MenuItemDef = {
        name: "Clone Row (auto PK)",
        action: async () => {
          if (!pkCol) return;
          const draftOps = useDraftStore.getState().ops;
          const existingPKs = rowData.map((r) => Number(r[pkCol.name])).filter((n) => !isNaN(n));
          const draftPKs = draftOps
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
              template_pk: { [pkCol.name]: rowNode[pkCol.name] },
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
            useUIStore.getState().setError(e?.error?.message || "Clone failed");
          }
        },
      };

      const batchCloneItem: MenuItemDef = {
        name: "Batch Clone...",
        action: () => {
          if (!pkCol) return;
          const config = {
            templateRow: rowNode,
            changeColumn: params.column?.getColDef().field,
          };
          setBatchGenerateConfig(config);
        },
      };

      const deleteItem: MenuItemDef = {
        name: "🗑 Delete Row",
        action: () => {
          if (!pkCol) return;
          const pkVal = rowNode[pkCol.name];
          addOp({
            type: "delete",
            table: tableName,
            values: {},
            pk: { [pkCol.name]: pkVal },
          });
          setBaseState("DraftEditing");
        },
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
    [isMain, editingBlocked, columns, rowData, tableName, targetId, dbName, branchName, addOp, setBaseState, onRowInserted, setHistoryTarget, setBatchGenerateConfig]
  );

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
      {/* Column toggle (top-right corner of grid) */}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "2px 8px", background: "#fafafa", borderBottom: "1px solid #e8e8f0", flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: "#888", marginRight: "auto" }}>
          {totalCount.toLocaleString()} rows {loading && "• Loading..."}
        </span>
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
