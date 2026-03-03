import { useState, useCallback, useEffect } from "react";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";
import { ApiError } from "../../api/errors";
import type { HistoryCommit, DiffSummaryEntry } from "../../types/api";

// ─── MergeLog ────────────────────────────────────────────────────────────────
//
// mainブランチのマージコミット一覧を表示する。
// - ハッシュ値は一切非表示
// - キーワード検索なし（日付フィルタのみ）
// - クリックでDiffサマリー展開 → テーブル名クリックでDiffTableDetail
//

interface Props {
    onClose: () => void;
}

interface CommitDiff {
    entries: DiffSummaryEntry[];
    loading: boolean;
    error: string | null;
}

function formatTimestamp(ts: string): string {
    if (!ts) return "—";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts.substring(0, 16).replace("T", " ");
    return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function MergeLog({ onClose }: Props) {
    const { targetId, dbName } = useContextStore();

    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [keyword, setKeyword] = useState("");
    const [commits, setCommits] = useState<HistoryCommit[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const pageSize = 30;

    // Expanded commit → per-table diff summary
    const [expandedHash, setExpandedHash] = useState<string | null>(null);
    const [diffMap, setDiffMap] = useState<Record<string, CommitDiff>>({});

    // Expanded table (within a commit)
    const [expandedTableKey, setExpandedTableKey] = useState<string | null>(null);
    const [exportingZip, setExportingZip] = useState(false);

    const handleSearch = useCallback(async (p = 1) => {
        if (!targetId || !dbName) return;
        setLoading(true);
        setSearched(false);
        setSearchError(null);
        setExpandedHash(null);
        setExpandedTableKey(null);
        try {
            const result = await api.getHistoryCommits(
                targetId,
                dbName,
                "main",
                p,
                pageSize,
                "merges_only",
                keyword,
                fromDate,
                toDate
            );
            setCommits(result || []);
            setPage(p);
            setSearched(true);
        } catch (err) {
            const msg = err instanceof ApiError ? err.message : "マージログの読み込みに失敗しました";
            setCommits([]);
            setSearchError(msg);
            setSearched(true);
        } finally {
            setLoading(false);
        }
    }, [targetId, dbName, keyword, fromDate, toDate]);

    // Auto-load on open
    useEffect(() => {
        handleSearch(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleToggleCommit = async (hash: string) => {
        if (expandedHash === hash) {
            setExpandedHash(null);
            return;
        }
        setExpandedHash(hash);
        setExpandedTableKey(null);

        if (diffMap[hash]) return; // already loaded

        setDiffMap((prev) => ({
            ...prev,
            [hash]: { entries: [], loading: true, error: null },
        }));
        try {
            const res = await api.getDiffSummary(targetId, dbName, "main", `${hash}^`, hash, "two_dot");
            setDiffMap((prev) => ({
                ...prev,
                [hash]: { entries: res.entries || [], loading: false, error: null },
            }));
        } catch {
            setDiffMap((prev) => ({
                ...prev,
                [hash]: { entries: [], loading: false, error: "差分の読み込みに失敗しました" },
            }));
        }
    };

    const handleExportZip = async (hash: string) => {
        setExportingZip(true);
        try {
            const { blob, filename } = await api.exportDiffZip(targetId, dbName, "main", `${hash}^`, hash, "two_dot");
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            // silently ignore
        } finally {
            setExportingZip(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal"
                style={{ minWidth: 680, maxWidth: 900, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ヘッダ */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h2 style={{ margin: 0, fontSize: 16 }}>📋 マージログ</h2>
                    <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#666" }}>✕</button>
                </div>

                {/* フィルタフォーム */}
                <div style={{
                    padding: "10px 12px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    marginBottom: 12,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    alignItems: "flex-end",
                }}>
                    <div style={{ flex: "2 1 200px" }}>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3, color: "#555" }}>
                            コミットメッセージ検索
                        </label>
                        <input
                            type="text"
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch(1)}
                            placeholder="キーワードで絞り込み"
                            style={{ width: "100%", fontSize: 13, padding: "4px 8px", boxSizing: "border-box" }}
                        />
                    </div>
                    <div style={{ flex: "1 1 120px" }}>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3, color: "#555" }}>
                            開始日
                        </label>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            style={{ width: "100%", fontSize: 13, padding: "4px 8px", boxSizing: "border-box" }}
                        />
                    </div>
                    <div style={{ flex: "1 1 120px" }}>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3, color: "#555" }}>
                            終了日
                        </label>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            style={{ width: "100%", fontSize: 13, padding: "4px 8px", boxSizing: "border-box" }}
                        />
                    </div>
                    <button
                        className="primary"
                        onClick={() => handleSearch(1)}
                        disabled={loading}
                        style={{ padding: "5px 16px", fontSize: 13, alignSelf: "flex-end" }}
                    >
                        {loading ? "読み込み中..." : "🔍 絞り込み"}
                    </button>
                </div>

                {/* 結果 */}
                <div style={{ flex: 1, overflowY: "auto" }}>
                    {!searched && loading && (
                        <div style={{ textAlign: "center", color: "#888", padding: 32, fontSize: 13 }}>読み込み中...</div>
                    )}

                    {searched && searchError && (
                        <div style={{ textAlign: "center", color: "#991b1b", padding: 32, fontSize: 13 }}>
                            ⚠ {searchError}
                        </div>
                    )}

                    {searched && !searchError && commits.length === 0 && (
                        <div style={{ textAlign: "center", color: "#888", padding: 32, fontSize: 13 }}>
                            マージコミットがありません。
                        </div>
                    )}

                    {commits.map((c) => {
                        const isExpanded = expandedHash === c.hash;
                        const diff = diffMap[c.hash];
                        const msgLines = c.message.split("\n");
                        const firstLine = msgLines[0];
                        const rest = msgLines.slice(1).filter(Boolean).join("\n");

                        return (
                            <div
                                key={c.hash}
                                style={{
                                    border: "1px solid #e2e8f0",
                                    borderRadius: 6,
                                    marginBottom: 8,
                                    background: isExpanded ? "#f0f9ff" : "#fff",
                                }}
                            >
                                {/* コミットヘッダ */}
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "flex-start",
                                        padding: "8px 12px",
                                        cursor: "pointer",
                                    }}
                                    onClick={() => handleToggleCommit(c.hash)}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", marginBottom: 2 }}>
                                            {firstLine}
                                        </div>
                                        {rest && (
                                            <div style={{ fontSize: 11, color: "#555", whiteSpace: "pre-wrap" }}>{rest}</div>
                                        )}
                                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                                            📅 {formatTimestamp(c.timestamp)}
                                            {c.author ? `　👤 ${c.author}` : ""}
                                        </div>
                                    </div>
                                    <span style={{ fontSize: 12, color: "#3b82f6", marginLeft: 8, flexShrink: 0 }}>
                                        {isExpanded ? "▲ 閉じる" : "▶ 差分"}
                                    </span>
                                </div>

                                {/* 差分サマリー展開 */}
                                {isExpanded && (
                                    <div style={{
                                        borderTop: "1px solid #e2e8f0",
                                        padding: "8px 12px",
                                        background: "#f8fafc",
                                    }}>
                                        {diff?.loading && (
                                            <div style={{ fontSize: 12, color: "#888" }}>差分を読み込み中...</div>
                                        )}
                                        {diff?.error && (
                                            <div style={{ fontSize: 12, color: "#991b1b" }}>{diff.error}</div>
                                        )}
                                        {diff && !diff.loading && !diff.error && diff.entries.length === 0 && (
                                            <div style={{ fontSize: 12, color: "#888" }}>テーブル変更なし</div>
                                        )}
                                        {diff && !diff.loading && diff.entries.length > 0 && (
                                            <>
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                                    <span style={{ fontSize: 11, color: "#666" }}>テーブル別変更数（クリックで詳細）</span>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleExportZip(c.hash); }}
                                                        disabled={exportingZip}
                                                        style={{ fontSize: 11, padding: "2px 8px", background: "#f0f4ff", border: "1px solid #4361ee", borderRadius: 4, color: "#4361ee", cursor: "pointer" }}
                                                    >
                                                        {exportingZip ? "生成中..." : "📥 ZIP"}
                                                    </button>
                                                </div>
                                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                                    <thead>
                                                        <tr style={{ borderBottom: "1px solid #d0d0d8", color: "#666" }}>
                                                            <th style={{ textAlign: "left", padding: "3px 8px" }}>テーブル</th>
                                                            <th style={{ textAlign: "right", padding: "3px 6px", color: "#065f46" }}>+追加</th>
                                                            <th style={{ textAlign: "right", padding: "3px 6px", color: "#92400e" }}>~変更</th>
                                                            <th style={{ textAlign: "right", padding: "3px 6px", color: "#991b1b" }}>-削除</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {diff.entries.map((e) => {
                                                            const tableKey = `${c.hash}::${e.table}`;
                                                            const isTableExpanded = expandedTableKey === tableKey;
                                                            return (
                                                                <tr
                                                                    key={e.table}
                                                                    style={{
                                                                        borderBottom: "1px solid #f0f0f5",
                                                                        cursor: "pointer",
                                                                        background: isTableExpanded ? "#e0e7ff" : undefined,
                                                                    }}
                                                                    onClick={(ev) => {
                                                                        ev.stopPropagation();
                                                                        setExpandedTableKey(isTableExpanded ? null : tableKey);
                                                                    }}
                                                                >
                                                                    <td style={{ padding: "3px 8px", fontFamily: "monospace", fontWeight: 500 }}>
                                                                        {e.table}
                                                                    </td>
                                                                    <td style={{ textAlign: "right", padding: "3px 6px", color: "#065f46" }}>
                                                                        {e.added > 0 ? `+${e.added}` : "—"}
                                                                    </td>
                                                                    <td style={{ textAlign: "right", padding: "3px 6px", color: "#92400e" }}>
                                                                        {e.modified > 0 ? `~${e.modified}` : "—"}
                                                                    </td>
                                                                    <td style={{ textAlign: "right", padding: "3px 6px", color: "#991b1b" }}>
                                                                        {e.removed > 0 ? `-${e.removed}` : "—"}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>

                                                {/* Inline DiffTableDetail for expanded table */}
                                                {expandedTableKey && expandedTableKey.startsWith(`${c.hash}::`) && (
                                                    <InlineDiff
                                                        targetId={targetId}
                                                        dbName={dbName}
                                                        branchName="main"
                                                        table={expandedTableKey.split("::")[1]}
                                                        fromRef={`${c.hash}^`}
                                                        toRef={c.hash}
                                                    />
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Pagination */}
                    {searched && (
                        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", padding: "8px 0" }}>
                            <button
                                disabled={page <= 1 || loading}
                                onClick={() => handleSearch(page - 1)}
                                style={{ fontSize: 12, padding: "3px 12px" }}
                            >
                                ◀ 前へ
                            </button>
                            <span style={{ fontSize: 12, color: "#666" }}>{page} ページ</span>
                            <button
                                disabled={commits.length < pageSize || loading}
                                onClick={() => handleSearch(page + 1)}
                                style={{ fontSize: 12, padding: "3px 12px" }}
                            >
                                次へ ▶
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── InlineDiff ───────────────────────────────────────────────────────────────
// Compact cell-level diff for a single table within MergeLog.

function InlineDiff({
    targetId,
    dbName,
    branchName,
    table,
    fromRef,
    toRef,
}: {
    targetId: string;
    dbName: string;
    branchName: string;
    table: string;
    fromRef: string;
    toRef: string;
}) {
    const [rows, setRows] = useState<import("../../types/api").DiffRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        setError(null);
        api.getDiffTable(targetId, dbName, branchName, table, fromRef, toRef, "two_dot", false, "", 1, 50)
            .then((res) => setRows(res.rows || []))
            .catch(() => setError("差分の読み込みに失敗しました"))
            .finally(() => setLoading(false));
    }, [targetId, dbName, branchName, table, fromRef, toRef]);

    if (loading) return <div style={{ fontSize: 11, color: "#888", padding: "4px 0" }}>読み込み中...</div>;
    if (error) return <div style={{ fontSize: 11, color: "#991b1b", padding: "4px 0" }}>{error}</div>;
    if (rows.length === 0) return <div style={{ fontSize: 11, color: "#888", padding: "4px 0" }}>行データなし</div>;

    // Derive columns
    const colSet = new Set<string>();
    for (const row of rows) {
        if (row.from) Object.keys(row.from).forEach((k) => colSet.add(k));
        if (row.to) Object.keys(row.to).forEach((k) => colSet.add(k));
    }
    const cols = Array.from(colSet);

    return (
        <div style={{ marginTop: 8, maxHeight: 300, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                <thead>
                    <tr style={{ background: "#f1f5f9" }}>
                        <th style={{ padding: "2px 6px", textAlign: "left", borderBottom: "1px solid #d0d0d8", width: 28 }}>変</th>
                        {cols.map((c) => (
                            <th key={c} style={{ padding: "2px 6px", textAlign: "left", borderBottom: "1px solid #d0d0d8" }}>{c}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => {
                        const values = row.diff_type === "removed" ? row.from : row.to;
                        const bg = row.diff_type === "added" ? "#dcfce7" : row.diff_type === "removed" ? "#fee2e2" : "#fef3c7";
                        const marker = row.diff_type === "added" ? "+" : row.diff_type === "removed" ? "-" : "~";
                        return (
                            <tr key={i} style={{ background: bg }}>
                                <td style={{ padding: "1px 6px", fontWeight: 700 }}>{marker}</td>
                                {cols.map((c) => {
                                    const val = values?.[c];
                                    const fromVal = row.from?.[c];
                                    const toVal = row.to?.[c];
                                    const isChanged = row.diff_type === "modified" && String(fromVal ?? "") !== String(toVal ?? "");
                                    return (
                                        <td
                                            key={c}
                                            style={{
                                                padding: "1px 6px",
                                                background: isChanged ? "#fde68a" : undefined,
                                                textDecoration: row.diff_type === "removed" ? "line-through" : undefined,
                                                color: row.diff_type === "removed" ? "#888" : undefined,
                                            }}
                                        >
                                            {val != null ? String(val) : ""}
                                            {isChanged && (
                                                <span style={{ color: "#92400e", fontSize: 9, marginLeft: 3 }}>
                                                    (旧:{String(fromVal ?? "")})
                                                </span>
                                            )}
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
