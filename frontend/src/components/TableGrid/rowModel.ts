import type { ColumnSchema, CommitOp } from "../../types/api";
import { stablePkJson } from "../../utils/stablePk";

export type GridRowSourceKind = "base" | "draftInsert";

export interface TableGridRow extends Record<string, unknown> {
  _rowId: string;
  _pkId: string;
  _sourceKind: GridRowSourceKind;
  _baseOrder: number;
  _clientRowId?: string;
}

export interface DraftVisualState {
  type: CommitOp["type"];
  changedCols: Set<string>;
}

interface FilterCondition {
  column: string;
  op: string;
  value?: unknown;
}

interface SortCondition {
  column: string;
  desc: boolean;
}

export interface BuildRowModelParams {
  baseRows: Record<string, unknown>[];
  draftOps: CommitOp[];
  pkCols: ColumnSchema[];
  tableName: string;
  filterJson: string;
  sortSpec: string;
  showDraftOnly: boolean;
}

export interface BuildRowModelResult {
  displayRows: TableGridRow[];
  rowById: Map<string, TableGridRow>;
  draftStateByRowId: Map<string, DraftVisualState>;
  duplicatePkRowIds: Set<string>;
}

function dataKeys(row: Record<string, unknown>): string[] {
  return Object.keys(row).filter((key) => !key.startsWith("_"));
}

function pkValuesFromRow(pkCols: ColumnSchema[], row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(pkCols.map((col) => [col.name, row[col.name]]));
}

function buildPkId(pkCols: ColumnSchema[], row: Record<string, unknown>, fallbackId: string): string {
  if (pkCols.length === 0) return fallbackId;
  return stablePkJson(pkValuesFromRow(pkCols, row));
}

function parseFilterConditions(filterJson: string): FilterCondition[] {
  if (!filterJson) return [];
  try {
    const parsed = JSON.parse(filterJson);
    return Array.isArray(parsed) ? parsed as FilterCondition[] : [];
  } catch {
    return [];
  }
}

function parseSortConditions(sortSpec: string): SortCondition[] {
  return sortSpec
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "")
    .map((token) => ({
      column: token.startsWith("-") ? token.slice(1) : token,
      desc: token.startsWith("-"),
    }));
}

function stringifyComparable(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function matchesFilter(row: Record<string, unknown>, filters: FilterCondition[]): boolean {
  return filters.every((filter) => {
    const value = row[filter.column];
    switch (filter.op) {
      case "eq":
        if (value === null || value === undefined || filter.value === null || filter.value === undefined) {
          return value === filter.value;
        }
        return stringifyComparable(value) === stringifyComparable(filter.value);
      case "neq":
        if (value === null || value === undefined || filter.value === null || filter.value === undefined) {
          return value !== filter.value;
        }
        return stringifyComparable(value) !== stringifyComparable(filter.value);
      case "contains":
        return stringifyComparable(value).includes(stringifyComparable(filter.value));
      case "startsWith":
        return stringifyComparable(value).startsWith(stringifyComparable(filter.value));
      case "endsWith":
        return stringifyComparable(value).endsWith(stringifyComparable(filter.value));
      case "blank":
        return value === null || value === undefined;
      case "notBlank":
        return value !== null && value !== undefined;
      case "in":
        return Array.isArray(filter.value)
          ? filter.value.map((item) => stringifyComparable(item)).includes(stringifyComparable(value))
          : false;
      default:
        return true;
    }
  });
}

export function comparePrimitiveValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  return stringifyComparable(left).localeCompare(stringifyComparable(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortRows(rows: TableGridRow[], sortSpec: string, pkCols: ColumnSchema[]): TableGridRow[] {
  const conditions = parseSortConditions(sortSpec);
  const seenCols = new Set(conditions.map((condition) => condition.column));
  for (const pkCol of pkCols) {
    if (!seenCols.has(pkCol.name)) {
      conditions.push({ column: pkCol.name, desc: false });
    }
  }
  if (conditions.length === 0) {
    return [...rows].sort((left, right) => left._baseOrder - right._baseOrder);
  }
  return [...rows].sort((left, right) => {
    for (const condition of conditions) {
      const compared = comparePrimitiveValues(left[condition.column], right[condition.column]);
      if (compared !== 0) {
        return condition.desc ? -compared : compared;
      }
    }
    return left._baseOrder - right._baseOrder;
  });
}

export function isDraftInsertRow(row: Record<string, unknown>): row is TableGridRow {
  return row._sourceKind === "draftInsert";
}

export function getTableGridRowId(row: Record<string, unknown>, pkCols: ColumnSchema[]): string {
  if (typeof row._rowId === "string" && row._rowId !== "") {
    return row._rowId;
  }
  const fallbackId = buildPkId(pkCols, row, "");
  return fallbackId ? `base:${fallbackId}` : "";
}

export function getTableGridPkId(row: Record<string, unknown>, pkCols: ColumnSchema[]): string {
  if (typeof row._pkId === "string" && row._pkId !== "") {
    return row._pkId;
  }
  return buildPkId(pkCols, row, "");
}

export function buildRowModel({
  baseRows,
  draftOps,
  pkCols,
  tableName,
  filterJson,
  sortSpec,
  showDraftOnly,
}: BuildRowModelParams): BuildRowModelResult {
  const baseDisplayRows = baseRows.map((row, index) => {
    const pkId = buildPkId(pkCols, row, `base-row:${index}`);
    return {
      ...row,
      _rowId: `base:${pkId}`,
      _pkId: pkId,
      _sourceKind: "base" as const,
      _baseOrder: index,
    };
  });

  const baseIndexByPkId = new Map<string, number>();
  for (let index = 0; index < baseDisplayRows.length; index += 1) {
    baseIndexByPkId.set(baseDisplayRows[index]._pkId, index);
  }

  const baseDraftStateByPkId = new Map<string, DraftVisualState>();
  const draftInsertByClientRowId = new Map<string, TableGridRow>();
  const draftInsertOrder: string[] = [];

  for (let opIndex = 0; opIndex < draftOps.length; opIndex += 1) {
    const op = draftOps[opIndex];
    if (op.table !== tableName) continue;

    if (op.type === "insert") {
      const clientRowId = op.client_row_id ?? `legacy:${opIndex}`;
      const pkId = buildPkId(pkCols, op.values, `draft:${clientRowId}`);
      const prior = draftInsertByClientRowId.get(clientRowId);
      if (!prior) {
        draftInsertOrder.push(clientRowId);
      }
      draftInsertByClientRowId.set(clientRowId, {
        ...(prior ?? {}),
        ...(op.values as Record<string, unknown>),
        _rowId: `draft:${clientRowId}`,
        _pkId: pkId,
        _sourceKind: "draftInsert",
        _baseOrder: prior?._baseOrder ?? baseRows.length + draftInsertOrder.length - 1,
        _clientRowId: clientRowId,
      });
      continue;
    }

    if (op.client_row_id) {
      const prior = draftInsertByClientRowId.get(op.client_row_id);
      if (!prior) continue;
      if (op.type === "delete") {
        draftInsertByClientRowId.delete(op.client_row_id);
      } else {
        draftInsertByClientRowId.set(op.client_row_id, {
          ...prior,
          ...(op.values as Record<string, unknown>),
          _pkId: buildPkId(pkCols, { ...prior, ...(op.values as Record<string, unknown>) }, prior._pkId),
        });
      }
      continue;
    }

    if (!op.pk) continue;
    const targetPkId = stablePkJson(op.pk);
    const baseIndex = baseIndexByPkId.get(targetPkId);
    if (baseIndex !== undefined && op.type === "update") {
      baseDisplayRows[baseIndex] = {
        ...baseDisplayRows[baseIndex],
        ...(op.values as Record<string, unknown>),
      };
    }

    const existingState = baseDraftStateByPkId.get(targetPkId);
    if (!existingState) {
      const changedCols = new Set<string>([
        ...Object.keys(op.pk),
        ...Object.keys(op.values ?? {}),
      ]);
      baseDraftStateByPkId.set(targetPkId, { type: op.type, changedCols });
      continue;
    }

    if (op.values) {
      for (const column of Object.keys(op.values)) {
        existingState.changedCols.add(column);
      }
    }
    if (op.type === "delete") {
      existingState.type = "delete";
    }
  }

  const allRows = [
    ...baseDisplayRows,
    ...draftInsertOrder
      .map((clientRowId) => draftInsertByClientRowId.get(clientRowId))
      .filter((row): row is TableGridRow => row != null),
  ];

  const draftStateByRowId = new Map<string, DraftVisualState>();
  for (const row of allRows) {
    if (row._sourceKind === "draftInsert") {
      draftStateByRowId.set(row._rowId, {
        type: "insert",
        changedCols: new Set<string>(dataKeys(row)),
      });
      continue;
    }
    const state = baseDraftStateByPkId.get(row._pkId);
    if (state) {
      draftStateByRowId.set(row._rowId, state);
    }
  }

  const duplicatePkRowIds = new Set<string>();
  for (const row of allRows) {
    if (row._sourceKind === "draftInsert" && baseIndexByPkId.has(row._pkId)) {
      duplicatePkRowIds.add(row._rowId);
    }
  }

  const filters = parseFilterConditions(filterJson);
  const locallyFilteredRows = filters.length > 0
    ? allRows.filter((row) => matchesFilter(row, filters))
    : allRows;
  const locallySortedRows = sortRows(locallyFilteredRows, sortSpec, pkCols);
  const displayRows = showDraftOnly
    ? locallySortedRows.filter((row) => draftStateByRowId.has(row._rowId))
    : locallySortedRows;

  return {
    displayRows,
    rowById: new Map(displayRows.map((row) => [row._rowId, row])),
    draftStateByRowId,
    duplicatePkRowIds,
  };
}
