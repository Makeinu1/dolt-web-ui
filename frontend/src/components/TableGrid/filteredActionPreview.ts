import type { ColumnSchema, CommitOp } from "../../types/api";
import { stablePkJson } from "../../utils/stablePk";
import { buildRowModel, type TableGridRow } from "./rowModel";

export const FILTERED_ACTION_PREVIEW_LIMIT = 1000;

export interface FilteredActionPreview {
  rows: TableGridRow[];
  count: number;
  containsDraftRows: boolean;
  capped: boolean;
}

interface BuildFilteredActionPreviewParams {
  persistedRows: Record<string, unknown>[];
  fetchedDraftBaseRows: Record<string, unknown>[];
  draftOps: CommitOp[];
  pkCols: ColumnSchema[];
  tableName: string;
  filterJson: string;
  sortSpec: string;
  showDraftOnly: boolean;
  serverTotalCount: number;
  limit?: number;
}

function pkFromRow(pkCols: ColumnSchema[], row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(pkCols.map((col) => [col.name, row[col.name]]));
}

export function collectMissingBaseDraftPks(
  persistedRows: Record<string, unknown>[],
  draftOps: CommitOp[],
  pkCols: ColumnSchema[],
  tableName: string,
): Record<string, unknown>[] {
  if (pkCols.length === 0) return [];

  const persistedPkIds = new Set(
    persistedRows.map((row) => stablePkJson(pkFromRow(pkCols, row)))
  );
  const missingPks = new Map<string, Record<string, unknown>>();

  for (const op of draftOps) {
    if (op.table !== tableName || op.client_row_id || !op.pk) continue;
    if (op.type !== "update" && op.type !== "delete") continue;
    const pkId = stablePkJson(op.pk);
    if (persistedPkIds.has(pkId) || missingPks.has(pkId)) continue;
    missingPks.set(pkId, op.pk);
  }

  return [...missingPks.values()];
}

export function countAffectedFetchedBaseRows(
  persistedRows: Record<string, unknown>[],
  draftOps: CommitOp[],
  pkCols: ColumnSchema[],
  tableName: string,
): number {
  if (pkCols.length === 0) return 0;

  const persistedPkIds = new Set(
    persistedRows.map((row) => stablePkJson(pkFromRow(pkCols, row)))
  );
  const affectedPkIds = new Set<string>();

  for (const op of draftOps) {
    if (op.table !== tableName || op.client_row_id || !op.pk) continue;
    if (op.type !== "update" && op.type !== "delete") continue;
    const pkId = stablePkJson(op.pk);
    if (!persistedPkIds.has(pkId)) continue;
    affectedPkIds.add(pkId);
  }

  return affectedPkIds.size;
}

export function getFilteredActionPersistedFetchTargetCount(
  persistedRows: Record<string, unknown>[],
  draftOps: CommitOp[],
  pkCols: ColumnSchema[],
  tableName: string,
  serverTotalCount: number,
  limit = FILTERED_ACTION_PREVIEW_LIMIT,
): number {
  return Math.min(
    serverTotalCount,
    limit + countAffectedFetchedBaseRows(persistedRows, draftOps, pkCols, tableName)
  );
}

function mergeBaseRowsByPk(
  persistedRows: Record<string, unknown>[],
  fetchedDraftBaseRows: Record<string, unknown>[],
  pkCols: ColumnSchema[],
): Record<string, unknown>[] {
  if (pkCols.length === 0) {
    return [...persistedRows, ...fetchedDraftBaseRows];
  }

  const mergedRows: Record<string, unknown>[] = [];
  const seenPkIds = new Set<string>();

  for (const row of [...persistedRows, ...fetchedDraftBaseRows]) {
    const pkId = stablePkJson(pkFromRow(pkCols, row));
    if (seenPkIds.has(pkId)) continue;
    seenPkIds.add(pkId);
    mergedRows.push(row);
  }

  return mergedRows;
}

export function buildFilteredActionPreview({
  persistedRows,
  fetchedDraftBaseRows,
  draftOps,
  pkCols,
  tableName,
  filterJson,
  sortSpec,
  showDraftOnly,
  serverTotalCount,
  limit = FILTERED_ACTION_PREVIEW_LIMIT,
}: BuildFilteredActionPreviewParams): FilteredActionPreview {
  const baseRows = mergeBaseRowsByPk(persistedRows, fetchedDraftBaseRows, pkCols);
  const rowModel = buildRowModel({
    baseRows,
    draftOps,
    pkCols,
    tableName,
    filterJson,
    sortSpec,
    showDraftOnly,
  });

  const fullRows = rowModel.displayRows;
  const rows = fullRows.slice(0, limit);

  return {
    rows,
    count: rows.length,
    containsDraftRows: rows.some((row) => rowModel.draftStateByRowId.has(row._rowId)),
    capped: fullRows.length > limit || serverTotalCount > persistedRows.length,
  };
}
