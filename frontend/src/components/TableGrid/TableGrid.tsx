import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, type ColDef, type CellValueChangedEvent } from "ag-grid-community";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";
import type { ColumnSchema, RowsResponse } from "../../types/api";

ModuleRegistry.registerModules([AllCommunityModule]);

interface TableGridProps {
  tableName: string;
}

export function TableGrid({ tableName }: TableGridProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const addOp = useDraftStore((s) => s.addOp);
  const setBaseState = useUIStore((s) => s.setBaseState);

  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [rowData, setRowData] = useState<Record<string, unknown>[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const gridRef = useRef<AgGridReact>(null);

  const isMain = branchName === "main";

  // Load schema
  useEffect(() => {
    if (!tableName) return;
    api
      .getTableSchema(targetId, dbName, branchName, tableName)
      .then((schema) => setColumns(schema.columns))
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
  }, [targetId, dbName, branchName, tableName, page, pageSize]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  // Column definitions for AG Grid
  const colDefs: ColDef[] = useMemo(() => {
    return columns.map((col) => ({
      field: col.name,
      headerName: col.name,
      editable: !isMain && !col.primary_key,
      sortable: true,
      filter: true,
      resizable: true,
      cellStyle: col.primary_key
        ? { backgroundColor: "#f0f0f5", fontWeight: 600 }
        : undefined,
    }));
  }, [columns, isMain]);

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
      </div>
      <div style={{ flex: 1 }}>
        <AgGridReact
          ref={gridRef}
          rowData={rowData}
          columnDefs={colDefs}
          defaultColDef={{
            flex: 1,
            minWidth: 100,
          }}
          onCellValueChanged={onCellValueChanged}
          suppressClickEdit={isMain}
          domLayout="autoHeight"
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
