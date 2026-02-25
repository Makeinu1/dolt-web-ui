import type { CommitOp } from "../types/api";

/**
 * Escapes a SQL string value (single-quote and backslash safe).
 */
function escapeSqlValue(v: unknown): string {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "boolean") return v ? "1" : "0";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
    const s = String(v)
        .replace(/\\/g, "\\\\")   // escape backslashes first
        .replace(/'/g, "''");       // then single-quotes
    return `'${s}'`;
}

/**
 * Escapes a SQL identifier (backtick-quoted).
 */
function escapeSqlIdentifier(name: string): string {
    return "`" + name.replace(/`/g, "``") + "`";
}

/**
 * Builds a SQL export string from a list of draft operations.
 * Suitable for saving as a .sql file for manual review and replay.
 */
export function buildDraftSQL(
    ops: CommitOp[],
    context: { targetId: string; dbName: string; branchName: string }
): string {
    const lines: string[] = [];
    lines.push(`-- Exported Draft Ops`);
    lines.push(`-- Target: ${context.targetId} / DB: ${context.dbName} / Branch: ${context.branchName}`);
    lines.push(`-- WARNING: Review this file carefully before executing against your database.`);
    lines.push(`-- Generated at: ${new Date().toISOString()}`);
    lines.push("");

    for (const op of ops) {
        const table = escapeSqlIdentifier(op.table);

        if (op.type === "insert") {
            const cols = Object.keys(op.values).map(escapeSqlIdentifier).join(", ");
            const vals = Object.values(op.values).map(escapeSqlValue).join(", ");
            lines.push(`INSERT INTO ${table} (${cols}) VALUES (${vals});`);

        } else if (op.type === "update") {
            if (!op.pk) continue;
            const setParts = Object.entries(op.values)
                .map(([c, v]) => `${escapeSqlIdentifier(c)} = ${escapeSqlValue(v)}`)
                .join(", ");
            const whereParts = Object.entries(op.pk)
                .map(([c, v]) => `${escapeSqlIdentifier(c)} = ${escapeSqlValue(v)}`)
                .join(" AND ");
            lines.push(`UPDATE ${table} SET ${setParts} WHERE ${whereParts};`);

        } else if (op.type === "delete") {
            if (!op.pk) continue;
            const whereParts = Object.entries(op.pk)
                .map(([c, v]) => `${escapeSqlIdentifier(c)} = ${escapeSqlValue(v)}`)
                .join(" AND ");
            lines.push(`DELETE FROM ${table} WHERE ${whereParts};`);
        }
    }

    return lines.join("\n");
}

/**
 * Triggers a browser file download of the draft SQL.
 */
export function downloadDraftSQL(
    ops: CommitOp[],
    context: { targetId: string; dbName: string; branchName: string }
): void {
    if (ops.length === 0) return;
    const sql = buildDraftSQL(ops, context);
    const blob = new Blob([sql], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `draft_export_${context.branchName}_${Date.now()}.sql`;
    a.click();
    URL.revokeObjectURL(url);
}
