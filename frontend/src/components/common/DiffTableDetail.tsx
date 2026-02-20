import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";
import type { DiffRow } from "../../types/api";

/**
 * DiffTableDetail — shows cell-level diff for a single table.
 * Fetches from DiffTable API (three-dot diff vs main) and displays
 * old → new for each changed cell, with highlighting.
 */
interface DiffTableDetailProps {
    table: string;
    /** Override target/db/branch from context if needed (e.g. for approver viewing another branch) */
    targetId?: string;
    dbName?: string;
    branchName?: string;
    fromRef?: string;
    toRef?: string;
}

export function DiffTableDetail({
    table,
    targetId: propTargetId,
    dbName: propDbName,
    branchName: propBranchName,
    fromRef,
    toRef,
}: DiffTableDetailProps) {
    const ctx = useContextStore();
    const targetId = propTargetId || ctx.targetId;
    const dbName = propDbName || ctx.dbName;
    const branchName = propBranchName || ctx.branchName;

    const [rows, setRows] = useState<DiffRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        const from = fromRef || "main";
        const to = toRef || branchName;

        api
            .getDiffTable(targetId, dbName, branchName, table, from, to, "three_dot")
            .then((res) => {
                if (!cancelled) setRows(res.rows || []);
            })
            .catch((err) => {
                const e = err as { error?: { message?: string } };
                if (!cancelled) setError(e?.error?.message || "Failed to load diff");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [targetId, dbName, branchName, table, fromRef, toRef]);

    if (loading) return <div style={{ fontSize: 12, color: "#888", padding: 8 }}>Loading diff...</div>;
    if (error) return <div style={{ fontSize: 12, color: "#991b1b", padding: 8 }}>⚠ {error}</div>;
    if (rows.length === 0) return <div style={{ fontSize: 12, color: "#888", padding: 8 }}>No changes.</div>;

    // Collect all column names from from/to
    const allCols = new Set<string>();
    for (const row of rows) {
        if (row.from) Object.keys(row.from).forEach((k) => allCols.add(k));
        if (row.to) Object.keys(row.to).forEach((k) => allCols.add(k));
    }
    const cols = Array.from(allCols);

    const TYPE_COLORS: Record<string, { bg: string; label: string }> = {
        added: { bg: "#dcfce7", label: "+ADD" },
        modified: { bg: "#fef3c7", label: "~MOD" },
        removed: { bg: "#fee2e2", label: "−DEL" },
    };

    return (
        <div style={{ overflowX: "auto", fontSize: 11 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                    <tr style={{ borderBottom: "2px solid #d0d0d8", color: "#666", fontSize: 10 }}>
                        <th style={{ padding: "3px 6px", textAlign: "left", width: 50 }}>Type</th>
                        {cols.map((col) => (
                            <th key={col} style={{ padding: "3px 6px", textAlign: "left" }}>{col}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => {
                        const tc = TYPE_COLORS[row.diff_type] || TYPE_COLORS.modified;
                        return (
                            <tr key={i} style={{ borderBottom: "1px solid #f0f0f5", background: tc.bg }}>
                                <td style={{ padding: "3px 6px", fontWeight: 700, fontSize: 10 }}>{tc.label}</td>
                                {cols.map((col) => {
                                    const fromVal = row.from?.[col];
                                    const toVal = row.to?.[col];
                                    const changed = row.diff_type === "modified" && String(fromVal) !== String(toVal);

                                    if (row.diff_type === "added") {
                                        return (
                                            <td key={col} style={{ padding: "3px 6px", fontFamily: "monospace", color: "#16a34a", fontWeight: 600 }}>
                                                {String(toVal ?? "")}
                                            </td>
                                        );
                                    }
                                    if (row.diff_type === "removed") {
                                        return (
                                            <td key={col} style={{ padding: "3px 6px", fontFamily: "monospace", color: "#dc2626", textDecoration: "line-through" }}>
                                                {String(fromVal ?? "")}
                                            </td>
                                        );
                                    }
                                    // Modified
                                    if (changed) {
                                        return (
                                            <td key={col} style={{ padding: "3px 6px", fontFamily: "monospace" }}>
                                                <span style={{ color: "#991b1b", textDecoration: "line-through", fontSize: 10 }}>{String(fromVal ?? "")}</span>
                                                <span style={{ color: "#065f46", fontWeight: 600, marginLeft: 4 }}>→ {String(toVal ?? "")}</span>
                                            </td>
                                        );
                                    }
                                    return (
                                        <td key={col} style={{ padding: "3px 6px", fontFamily: "monospace", color: "#888" }}>
                                            {String(toVal ?? fromVal ?? "")}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
