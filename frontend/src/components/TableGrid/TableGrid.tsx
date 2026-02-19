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
} from "ag-grid-community";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import { useTemplateStore } from "../../store/template";
import { RecordHistoryPopup } from "../common/RecordHistoryPopup";
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
      >
        Columns ({visibleCount}/{columns.length})
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
  const setBaseState = useUIStore((s) => s.setBaseState);
  const { setTemplate } = useTemplateStore();

  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [rowData, setRowData] = useState<Record<string, unknown>[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [historyTarget, setHistoryTarget] = useState<{ pkJson: string; pkLabel: string } | null>(null);
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

      // "Show History" is always available (main branch and work branches)
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

      const cloneItem = {
        name: "Clone Row (auto PK)",
        action: async () => {
          if (!pkCol) return;

          // Auto-generate next PK from loaded rows + draft ops
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
              alert(result.errors[0].message);
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
            alert(e?.error?.message || "Clone failed");
          }
        },
      };

      const templateItem = {
        name: "Set as Template",
        action: () => {
          setTemplate(rowNode, tableName, columns);
        },
      };

      return [historyItem, "separator" as unknown as MenuItemDef, cloneItem, templateItem, "separator" as unknown as MenuItemDef, "copy" as unknown as MenuItemDef];
    },
    [isMain, editingBlocked, columns, rowData, tableName, targetId, dbName, branchName, addOp, setBaseState, onRowInserted, setTemplate, setHistoryTarget]
  );

  // Column definitions for AG Grid
  const colDefs: ColDef[] = useMemo(() => {
    const visibleCols = columns.filter((col) => !hiddenColumns.has(col.name));

    return visibleCols.map((col) => ({
      field: col.name,
      headerName: col.name,
      editable: !editingBlocked && !col.primary_key,
      sortable: true,
      filter: true,
      resizable: true,
      cellStyle: col.primary_key
        ? { backgroundColor: "#f0f0f5", fontWeight: 600 }
        : undefined,
    }));
  }, [columns, hiddenColumns, editingBlocked]);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="table-info">
        <span>{tableName}</span>
        <span>{totalCount} rows</span>
        <span>
          Page {page} / {totalPages}
        </span>
        {loading && <span>Loading...</span>}
        <div style={{ flex: 1 }} />
        <ColumnToggle
          columns={columns}
          hiddenColumns={hiddenColumns}
          onToggle={handleColumnToggle}
        />
      </div>
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
      <div className="toolbar" style={{ justifyContent: "center" }}>
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Prev
        </button>
        <span style={{ fontSize: 13 }}>
          {page} / {totalPages}
        </span>
        <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>

      {historyTarget && (
        <RecordHistoryPopup
          table={tableName}
          pkJson={historyTarget.pkJson}
          pkLabel={historyTarget.pkLabel}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </div>
  );
}
