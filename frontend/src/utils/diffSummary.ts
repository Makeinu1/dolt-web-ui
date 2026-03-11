import type {
  DiffSummaryEntry,
  DiffSummaryLightEntry,
} from "../types/api";

export interface DisplayDiffSummaryEntry {
  table: string;
  added: number;
  modified: number;
  removed: number;
  hasDataChange: boolean;
  hasSchemaChange: boolean;
}

export function mergeDiffSummaryEntries(
  lightEntries: DiffSummaryLightEntry[],
  heavyEntries: DiffSummaryEntry[]
): DisplayDiffSummaryEntry[] {
  const byTable = new Map<string, DisplayDiffSummaryEntry>();

  for (const lightEntry of lightEntries) {
    byTable.set(lightEntry.table, {
      table: lightEntry.table,
      added: 0,
      modified: 0,
      removed: 0,
      hasDataChange: lightEntry.has_data_change,
      hasSchemaChange: lightEntry.has_schema_change,
    });
  }

  for (const heavyEntry of heavyEntries) {
    const existing = byTable.get(heavyEntry.table);
    byTable.set(heavyEntry.table, {
      table: heavyEntry.table,
      added: heavyEntry.added,
      modified: heavyEntry.modified,
      removed: heavyEntry.removed,
      hasDataChange:
        existing?.hasDataChange ??
        heavyEntry.added + heavyEntry.modified + heavyEntry.removed > 0,
      hasSchemaChange: existing?.hasSchemaChange ?? false,
    });
  }

  return Array.from(byTable.values()).sort((a, b) => a.table.localeCompare(b.table));
}
