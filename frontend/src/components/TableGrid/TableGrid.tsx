import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type CellValueChangedEvent,
  type ICellRendererParams,
  type FirstDataRenderedEvent,
} from "ag-grid-community";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";
import type { ColumnSchema, RowsResponse } from "../../types/api";

ModuleRegistry.registerModules([AllCommunityModule]);

// --- Copy button renderer (one-click row clone with auto PK) ---
interface CopyButtonParams extends ICellRendererParams {
  tableName: string;
  columns: ColumnSchema[];
  rowData: Record<string, unknown>[];
  onRowInserted: (row: Record<string, unknown>) => void;
}

function CopyButtonRenderer(params: CopyButtonParams) {
  const [copying, setCopying] = useState(false);

  if (!params.data) return null;

  // Hide Copy button for uncommitted (optimistically inserted) rows
  const pkCol = params.columns.find((c) => c.primary_key);
  if (pkCol) {
    const rowPK = params.data[pkCol.name];
    const draftOps = useDraftStore.getState().ops;
    const isUncommitted = draftOps.some(
      (op) =>
        op.type === "insert" &&
        op.table === params.tableName &&
        String(op.values[pkCol.name]) === String(rowPK)
    );
    if (isUncommitted) return null;
  }

  const handleCopy = async () => {
    const { targetId, dbName, branchName } = useContextStore.getState();
    const pkCol = params.columns.find((c) => c.primary_key);
    if (!pkCol) return;

    // Auto-generate next PK from loaded rows
    const allRows = params.rowData;
    const draftOps = useDraftStore.getState().ops;
    const existingPKs = allRows.map((r) => Number(r[pkCol.name])).filter((n) => !isNaN(n));
    const draftPKs = draftOps
      .filter((op) => op.table === params.tableName && op.type === "insert" && op.values[pkCol.name] != null)
      .map((op) => Number(op.values[pkCol.name]))
      .filter((n) => !isNaN(n));
    const allPKs = [...existingPKs, ...draftPKs];
    const maxPK = allPKs.length > 0 ? Math.max(...allPKs) : 0;
    const newPK = maxPK + 1;

    setCopying(true);
    try {
      const result = await api.previewClone({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        table: params.tableName,
        template_pk: { [pkCol.name]: params.data[pkCol.name] },
        new_pks: [newPK],
      });
      if (result.errors?.length > 0) {
        alert(result.errors[0].message);
      } else {
        for (const op of result.ops) {
          useDraftStore.getState().addOp(op);
        }
        useUIStore.getState().setBaseState("DraftEditing");
        // Optimistically add the new row to the grid
        const insertOp = result.ops.find((op: { type: string }) => op.type === "insert");
        if (insertOp && params.onRowInserted) {
          params.onRowInserted(insertOp.values as Record<string, unknown>);
        }
      }
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      alert(e?.error?.message || "Copy failed");
    } finally {
      setCopying(false);
    }
  };

  return (
    <button
      onClick={handleCopy}
      disabled={copying}
      style={{
        fontSize: 11,
        padding: "2px 8px",
        cursor: copying ? "wait" : "pointer",
        border: "1px solid #c0c0d0",
        borderRadius: 3,
        background: copying ? "#e8e8f0" : "#f0f0f5",
      }}
    >
      {copying ? "..." : "Copy"}
    </button>
  );
}

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

  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [rowData, setRowData] = useState<Record<string, unknown>[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
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

  // Optimistic row insert for Copy button
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

  // Column definitions for AG Grid
  const colDefs: ColDef[] = useMemo(() => {
    const visibleCols = columns.filter((col) => !hiddenColumns.has(col.name));

    const dataCols: ColDef[] = visibleCols.map((col) => ({
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

    // Add Copy column on work branches
    if (!isMain) {
      const actionCol: ColDef = {
        headerName: "",
        colId: "__actions",
        pinned: "left",
        width: 70,
        maxWidth: 70,
        sortable: false,
        filter: false,
        editable: false,
        suppressNavigable: true,
        cellRenderer: CopyButtonRenderer,
        cellRendererParams: {
          tableName,
          columns,
          rowData,
          onRowInserted,
        },
      };
      return [actionCol, ...dataCols];
    }

    return dataCols;
  }, [columns, hiddenColumns, editingBlocked, isMain, tableName, rowData, onRowInserted]);

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
    </div>
  );
}
