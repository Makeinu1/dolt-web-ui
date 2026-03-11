import { useState, useCallback, useEffect, useRef, memo } from "react";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";
import { ApiError } from "../../api/errors";
import type { DiffSummaryEntry, DiffSummaryLightEntry, HistoryCommit } from "../../types/api";
import { readIntegrityMessage } from "../../utils/apiResult";
import { mergeDiffSummaryEntries } from "../../utils/diffSummary";

// ─── MergeLog ────────────────────────────────────────────────────────────────
//
// mainブランチのマージコミット一覧を表示する。
// - ハッシュ値は一切非表示
// - キーワード検索なし（日付フィルタのみ）
// - クリックでDiffサマリー展開 → テーブル名クリックでDiffTableDetail
//

interface Props {
    onClose: () => void;
    /** 2c: Called when user clicks "Browse" on a past merge commit */
    onPreviewCommit?: (hash: string, label: string) => void;
    /** Record-level filter: show only merges that changed this table's record */
    filterTable?: string;
    filterPk?: string;
}

interface CommitDiff {
    entries: DiffSummaryEntry[];
    loading: boolean;
    error: string | null;
}

interface CommitLightSummary {
    changedTableCount: number;
    tables: DiffSummaryLightEntry[];
    loading: boolean;
    error: string | null;
}

const LIGHT_PRELOAD_CONCURRENCY = 4;
const SUMMARY_CHIP_PREVIEW_COUNT = 3;

function formatTimestamp(ts: string): string {
    if (!ts) return "—";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts.substring(0, 16).replace("T", " ");
    return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function MergeLog({ onClose, onPreviewCommit, filterTable, filterPk }: Props) {
    const { targetId, dbName } = useContextStore();

    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [keyword, setKeyword] = useState("");
    const [searchField, setSearchField] = useState<"message" | "branch">("message");
    const [commits, setCommits] = useState<HistoryCommit[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const pageSize = 30;

    const [lightDiffMap, setLightDiffMap] = useState<Record<string, CommitLightSummary>>({});
    const [heavyDiffMap, setHeavyDiffMap] = useState<Record<string, CommitDiff>>({});
    const lightStatusRef = useRef<Record<string, "loading" | "loaded">>({});
    const heavyStatusRef = useRef<Record<string, "loading" | "loaded">>({});
    const searchVersionRef = useRef(0);

    const [expandedCommitHash, setExpandedCommitHash] = useState<string | null>(null);
    const [expandedTableKey, setExpandedTableKey] = useState<string | null>(null);
    const [exportingZip, setExportingZip] = useState(false);
    const [zipError, setZipError] = useState<string | null>(null);
    const [zipWarning, setZipWarning] = useState<string | null>(null);

    // 2b: cross-merge comparison — up to 2 selected hashes
    const [compareHashes, setCompareHashes] = useState<string[]>([]);
    const [compareResult, setCompareResult] = useState<CommitDiff | null>(null);
    const [compareLoading, setCompareLoading] = useState(false);
    const [compareError, setCompareError] = useState<string | null>(null);
    const [compareTableKey, setCompareTableKey] = useState<string | null>(null);

    const loadLightSummary = useCallback(async (hash: string, version = searchVersionRef.current) => {
        if (searchVersionRef.current !== version) return;

        const status = lightStatusRef.current[hash];
        if (status === "loading" || status === "loaded") return;

        lightStatusRef.current[hash] = "loading";
        setLightDiffMap((prev) => ({
            ...prev,
            [hash]: {
                changedTableCount: prev[hash]?.changedTableCount || 0,
                tables: prev[hash]?.tables || [],
                loading: true,
                error: null,
            },
        }));

        try {
            const res = await api.getDiffSummaryLight(targetId, dbName, "main", `${hash}^`, hash, "two_dot");
            if (searchVersionRef.current !== version) return;
            lightStatusRef.current[hash] = "loaded";
            setLightDiffMap((prev) => ({
                ...prev,
                [hash]: {
                    changedTableCount: res.changed_table_count || 0,
                    tables: res.tables || [],
                    loading: false,
                    error: null,
                },
            }));
        } catch {
            if (searchVersionRef.current !== version) return;
            delete lightStatusRef.current[hash];
            setLightDiffMap((prev) => ({
                ...prev,
                [hash]: {
                    changedTableCount: 0,
                    tables: [],
                    loading: false,
                    error: "変更テーブルの読み込みに失敗しました",
                },
            }));
        }
    }, [targetId, dbName]);

    const preloadLightSummaries = useCallback(async (hashes: string[], version: number) => {
        if (hashes.length === 0) return;

        let nextIndex = 0;
        const workerCount = Math.min(LIGHT_PRELOAD_CONCURRENCY, hashes.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (searchVersionRef.current === version) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                if (currentIndex >= hashes.length) return;
                await loadLightSummary(hashes[currentIndex], version);
            }
        });

        await Promise.all(workers);
    }, [loadLightSummary]);

    const loadHeavySummary = useCallback(async (hash: string, version = searchVersionRef.current) => {
        if (searchVersionRef.current !== version) return;

        const status = heavyStatusRef.current[hash];
        if (status === "loading" || status === "loaded") return;

        heavyStatusRef.current[hash] = "loading";
        setHeavyDiffMap((prev) => ({
            ...prev,
            [hash]: { entries: prev[hash]?.entries || [], loading: true, error: null },
        }));

        try {
            const res = await api.getDiffSummary(targetId, dbName, "main", `${hash}^`, hash, "two_dot");
            if (searchVersionRef.current !== version) return;
            heavyStatusRef.current[hash] = "loaded";
            setHeavyDiffMap((prev) => ({
                ...prev,
                [hash]: { entries: res.entries || [], loading: false, error: null },
            }));
        } catch (err) {
            if (searchVersionRef.current !== version) return;
            delete heavyStatusRef.current[hash];
            const message = err instanceof ApiError ? err.message : "件数集計に失敗しました";
            setHeavyDiffMap((prev) => ({
                ...prev,
                [hash]: { entries: [], loading: false, error: message },
            }));
        }
    }, [targetId, dbName]);

    const handleSearch = useCallback(async (p = 1) => {
        if (!targetId || !dbName) return;
        const version = searchVersionRef.current + 1;
        searchVersionRef.current = version;
        lightStatusRef.current = {};
        heavyStatusRef.current = {};
        setLoading(true);
        setSearched(false);
        setSearchError(null);
        setZipWarning(null);
        setLightDiffMap({});
        setHeavyDiffMap({});
        setExpandedCommitHash(null);
        setExpandedTableKey(null);
        setCompareHashes([]);
        setCompareResult(null);
        setCompareError(null);
        setCompareTableKey(null);
        try {
            const result = await api.getHistoryCommits(
                targetId,
                dbName,
                "main",
                p,
                pageSize,
                keyword,
                fromDate,
                toDate,
                searchField,
                filterTable ?? "",
                filterPk ?? ""
            );
            if (searchVersionRef.current !== version) return;
            const integrityError = readIntegrityMessage(result, "履歴の整合性を確認できませんでした");
            if (integrityError) {
                setCommits([]);
                setSearchError(integrityError);
                setSearched(true);
                return;
            }
            setCommits(result.commits || []);
            setPage(p);
            setSearched(true);
            void preloadLightSummaries((result.commits || []).map((c) => c.hash), version);
        } catch (err) {
            if (searchVersionRef.current !== version) return;
            const msg = err instanceof ApiError ? err.message : "マージログの読み込みに失敗しました";
            setCommits([]);
            setSearchError(msg);
            setSearched(true);
        } finally {
            if (searchVersionRef.current === version) {
                setLoading(false);
            }
        }
    }, [targetId, dbName, keyword, fromDate, toDate, searchField, filterTable, filterPk, preloadLightSummaries]);

    // Auto-load on open
    useEffect(() => {
        handleSearch(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Toggle InlineDiff visibility (DiffSummary is always shown)
    const handleToggleInlineDiff = (hash: string, table: string) => {
        const tableKey = `${hash}::${table}`;
        setExpandedTableKey((prev) => prev === tableKey ? null : tableKey);
    };

    const handleToggleCommit = (hash: string) => {
        const nextHash = expandedCommitHash === hash ? null : hash;
        setExpandedCommitHash(nextHash);
        setExpandedTableKey(null);
        if (nextHash === hash) {
            void loadLightSummary(hash);
            void loadHeavySummary(hash);
        }
    };

    const handleExportZip = async (hash: string) => {
        setExportingZip(true);
        setZipError(null);
        setZipWarning(null);
        try {
            const { blob, filename, warning } = await api.exportDiffZip(targetId, dbName, "main", `${hash}^`, hash, "two_dot");
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            if (warning) {
                setZipWarning(warning);
            }
        } catch {
            setZipError("ZIPのエクスポートに失敗しました");
        } finally {
            setExportingZip(false);
        }
    };

    // 2b: Compare two selected merge commits (from older to newer by list position)
    const handleCompare = async () => {
        if (compareHashes.length !== 2) return;
        // Determine order: find which comes first in the commits list
        const idxA = commits.findIndex((c) => c.hash === compareHashes[0]);
        const idxB = commits.findIndex((c) => c.hash === compareHashes[1]);
        // commits are sorted newest-first, so higher index = older
        const [newerHash, olderHash] = idxA < idxB
            ? [compareHashes[0], compareHashes[1]]
            : [compareHashes[1], compareHashes[0]];
        setCompareLoading(true);
        setCompareError(null);
        setCompareResult(null);
        setCompareTableKey(null);
        try {
            const res = await api.getDiffSummary(targetId, dbName, "main", olderHash, newerHash, "two_dot");
            setCompareResult({ entries: res.entries || [], loading: false, error: null });
        } catch {
            setCompareError("比較の読み込みに失敗しました");
        } finally {
            setCompareLoading(false);
        }
    };

    const toggleCompareHash = (hash: string) => {
        setCompareHashes((prev) => {
            if (prev.includes(hash)) return prev.filter((h) => h !== hash);
            if (prev.length >= 2) return [prev[1], hash]; // keep latest 2
            return [...prev, hash];
        });
        // Reset existing comparison when selection changes
        setCompareResult(null);
        setCompareError(null);
        setCompareTableKey(null);
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
                    <h2 style={{ margin: 0, fontSize: 16 }}>{filterTable ? "🔍 行のマージ履歴" : "📋 マージログ"}</h2>
                    <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#666" }}>✕</button>
                </div>

                {/* Record filter badge */}
                {filterTable && (
                    <div style={{ fontSize: 11, color: "#1e40af", background: "#dbeafe", padding: "4px 10px", borderRadius: 4, marginBottom: 8 }}>
                        🔍 {filterTable} のレコード — PK: {filterPk}
                    </div>
                )}

                {/* ZIP export error */}
                {zipError && (
                    <div style={{ padding: "4px 10px", background: "#fee2e2", color: "#991b1b", fontSize: 12, borderRadius: 4, marginBottom: 8 }}>
                        {zipError}
                    </div>
                )}
                {zipWarning && (
                    <div style={{ padding: "4px 10px", background: "#fef3c7", color: "#92400e", fontSize: 12, borderRadius: 4, marginBottom: 8 }}>
                        {zipWarning}
                    </div>
                )}

                {/* 2b: compare selection bar */}
                <div style={{
                    padding: "8px 12px",
                    background: compareHashes.length > 0 ? "#eff6ff" : "#f8fafc",
                    border: `1px solid ${compareHashes.length > 0 ? "#93c5fd" : "#e2e8f0"}`,
                    borderRadius: 6,
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12,
                }}>
                    <span style={{ color: "#555", flex: 1 }}>
                        {compareHashes.length === 0
                            ? "☑ 比べたい2件にチェックを入れて「比較」ボタンを押してください"
                            : compareHashes.length === 1
                                ? "☑ もう1件チェックしてください"
                                : "✅ 2件選択済み — 比較できます"}
                    </span>
                    {compareHashes.length === 2 && (
                        <button
                            onClick={handleCompare}
                            disabled={compareLoading}
                            style={{ fontSize: 12, padding: "3px 12px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                            {compareLoading ? "読み込み中..." : "🔍 比較"}
                        </button>
                    )}
                    {compareHashes.length > 0 && (
                        <button
                            onClick={() => { setCompareHashes([]); setCompareResult(null); setCompareError(null); setCompareTableKey(null); }}
                            style={{ fontSize: 11, padding: "2px 8px", background: "none", border: "1px solid #94a3b8", borderRadius: 4, cursor: "pointer", color: "#64748b" }}
                        >
                            ✕ 解除
                        </button>
                    )}
                </div>

                {/* 2b: comparison result panel */}
                {(compareResult || compareError) && (
                    <div style={{ border: "1px solid #93c5fd", borderRadius: 6, marginBottom: 10, background: "#f0f7ff" }}>
                        <div style={{ padding: "6px 12px", borderBottom: "1px solid #bfdbfe", fontSize: 12, fontWeight: 600, color: "#1d4ed8" }}>
                            🔍 2バージョン間の変更一覧
                        </div>
                        {compareError && (
                            <div style={{ padding: "8px 12px", color: "#991b1b", fontSize: 12 }}>{compareError}</div>
                        )}
                        {compareResult && compareResult.entries.length === 0 && (
                            <div style={{ padding: "8px 12px", color: "#888", fontSize: 12 }}>変更なし</div>
                        )}
                        {compareResult && compareResult.entries.length > 0 && (
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                <thead>
                                    <tr style={{ borderBottom: "1px solid #bfdbfe", color: "#555" }}>
                                        <th style={{ textAlign: "left", padding: "4px 12px" }}>テーブル</th>
                                        <th style={{ textAlign: "right", padding: "4px 8px", color: "#065f46" }}>+追加</th>
                                        <th style={{ textAlign: "right", padding: "4px 8px", color: "#92400e" }}>~変更</th>
                                        <th style={{ textAlign: "right", padding: "4px 8px", color: "#991b1b" }}>-削除</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {compareResult.entries.map((e) => {
                                        const ck = `compare::${e.table}`;
                                        const isExp = compareTableKey === ck;
                                        return (
                                            <tr
                                                key={e.table}
                                                style={{ borderBottom: "1px solid #dbeafe", cursor: "pointer", background: isExp ? "#dbeafe" : undefined }}
                                                onClick={() => setCompareTableKey(isExp ? null : ck)}
                                            >
                                                <td style={{ padding: "3px 12px", fontFamily: "monospace" }}>{e.table}{isExp ? " ▲" : " ▶"}</td>
                                                <td style={{ textAlign: "right", padding: "3px 8px", color: "#065f46" }}>{e.added > 0 ? `+${e.added}` : "—"}</td>
                                                <td style={{ textAlign: "right", padding: "3px 8px", color: "#92400e" }}>{e.modified > 0 ? `~${e.modified}` : "—"}</td>
                                                <td style={{ textAlign: "right", padding: "3px 8px", color: "#991b1b" }}>{e.removed > 0 ? `-${e.removed}` : "—"}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                        {compareResult && compareTableKey && compareTableKey.startsWith("compare::") && (() => {
                            const idxA = commits.findIndex((c) => c.hash === compareHashes[0]);
                            const idxB = commits.findIndex((c) => c.hash === compareHashes[1]);
                            const [newerH, olderH] = idxA < idxB ? [compareHashes[0], compareHashes[1]] : [compareHashes[1], compareHashes[0]];
                            return (
                                <InlineDiff
                                    targetId={targetId}
                                    dbName={dbName}
                                    branchName="main"
                                    table={compareTableKey.split("::")[1]}
                                    fromRef={olderH}
                                    toRef={newerH}
                                />
                            );
                        })()}
                    </div>
                )}

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
                            {searchField === "branch" ? "ブランチ名検索" : "コミットメッセージ検索"}
                        </label>
                        <div style={{ display: "flex", gap: 4 }}>
                            <select
                                value={searchField}
                                onChange={(e) => setSearchField(e.target.value as "message" | "branch")}
                                style={{ fontSize: 12, padding: "4px 6px", flexShrink: 0 }}
                            >
                                <option value="message">コミットログ</option>
                                <option value="branch">ブランチ名</option>
                            </select>
                            <input
                                type="text"
                                value={keyword}
                                onChange={(e) => setKeyword(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSearch(1)}
                                placeholder={searchField === "branch" ? "ブランチ名で絞り込み" : "キーワードで絞り込み"}
                                style={{ flex: 1, fontSize: 13, padding: "4px 8px", boxSizing: "border-box" }}
                            />
                        </div>
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
                        const light = lightDiffMap[c.hash];
                        const heavy = heavyDiffMap[c.hash];
                        const msgLines = c.message.split("\n");
                        const firstLine = msgLines[0];
                        const isChecked = compareHashes.includes(c.hash);
                        const isCommitExpanded = expandedCommitHash === c.hash;
                        const mergedEntries = mergeDiffSummaryEntries(light?.tables || [], heavy?.entries || []);
                        const previewTables = (light?.tables || []).slice(0, SUMMARY_CHIP_PREVIEW_COUNT);

                        return (
                            <div
                                key={c.hash}
                                style={{
                                    border: `1px solid ${isChecked ? "#4361ee" : "#e2e8f0"}`,
                                    borderRadius: 6,
                                    marginBottom: 8,
                                    background: isChecked ? "#f0f4ff" : "#fff",
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
                                    {/* 2b: checkbox */}
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={(e) => {
                                            e.stopPropagation();
                                            toggleCompareHash(c.hash);
                                        }}
                                        title="比較対象として選択"
                                        style={{ marginRight: 8, marginTop: 3, flexShrink: 0, cursor: "pointer" }}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        {/* 2a: branch name badge */}
                                        {c.merge_branch && (
                                            <span style={{
                                                display: "inline-block",
                                                background: "#dbeafe",
                                                color: "#1d4ed8",
                                                fontSize: 10,
                                                fontWeight: 700,
                                                padding: "1px 6px",
                                                borderRadius: 10,
                                                marginBottom: 3,
                                                fontFamily: "monospace",
                                            }}>
                                                🔀 {c.merge_branch}
                                            </span>
                                        )}
                                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", marginBottom: 2 }}>
                                            {firstLine}
                                            {light && !light.loading && light.changedTableCount > 0 && (
                                                <span style={{ fontSize: 11, color: "#888", fontWeight: 400, marginLeft: 8 }}>
                                                    ({light.changedTableCount}テーブル変更)
                                                </span>
                                            )}
                                        </div>
                                        {light?.loading && (
                                            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                                                変更テーブルを確認中...
                                            </div>
                                        )}
                                        {light?.error && (
                                            <div style={{ fontSize: 11, color: "#991b1b", marginTop: 2 }}>
                                                {light.error}
                                            </div>
                                        )}
                                        {!light?.loading && !light?.error && light && light.changedTableCount > 0 && (
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                                                <span style={{ fontSize: 11, color: "#475569" }}>
                                                    {light.changedTableCount}テーブル変更
                                                </span>
                                                {previewTables.map((tableEntry) => (
                                                    <span
                                                        key={`${c.hash}-${tableEntry.table}`}
                                                        style={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 4,
                                                            padding: "1px 8px",
                                                            background: "#f1f5f9",
                                                            borderRadius: 999,
                                                            fontSize: 10,
                                                            color: "#334155",
                                                            fontFamily: "monospace",
                                                        }}
                                                    >
                                                        {tableEntry.table}
                                                        {tableEntry.has_schema_change && (
                                                            <span style={{ color: "#1d4ed8" }}>schema</span>
                                                        )}
                                                    </span>
                                                ))}
                                                {light.changedTableCount > SUMMARY_CHIP_PREVIEW_COUNT && (
                                                    <span style={{ fontSize: 10, color: "#64748b" }}>
                                                        +{light.changedTableCount - SUMMARY_CHIP_PREVIEW_COUNT}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                                            📅 {formatTimestamp(c.timestamp)}
                                            {c.author ? `　👤 ${c.author}` : ""}
                                        </div>
                                    </div>
                                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0, marginLeft: 8 }}>
                                        {/* 2c: browse past version */}
                                        {onPreviewCommit && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const label = c.merge_branch
                                                        ? `${c.merge_branch} (${formatTimestamp(c.timestamp)})`
                                                        : formatTimestamp(c.timestamp);
                                                    onPreviewCommit(c.hash, label);
                                                    onClose();
                                                }}
                                                title="このバージョンのデータを閲覧"
                                                style={{ fontSize: 11, padding: "2px 8px", background: "#f0fdf4", border: "1px solid #16a34a", borderRadius: 4, color: "#16a34a", cursor: "pointer", whiteSpace: "nowrap" }}
                                            >
                                                📋 閲覧
                                            </button>
                                        )}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleToggleCommit(c.hash);
                                            }}
                                            style={{ fontSize: 11, padding: "2px 8px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 4, color: "#334155", cursor: "pointer", whiteSpace: "nowrap" }}
                                        >
                                            {isCommitExpanded ? "詳細を閉じる" : "詳細を表示"}
                                        </button>
                                    </div>
                                </div>

                                {isCommitExpanded && (
                                    <div style={{
                                        borderTop: "1px solid #e2e8f0",
                                        padding: "8px 12px",
                                        background: "#f8fafc",
                                    }}>
                                        {light?.loading && (
                                            <div style={{ fontSize: 12, color: "#888" }}>変更テーブルを読み込み中...</div>
                                        )}
                                        {light?.error && (
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                                <div style={{ fontSize: 12, color: "#991b1b" }}>{light.error}</div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); void loadLightSummary(c.hash); }}
                                                    style={{ fontSize: 11, padding: "2px 8px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer", color: "#334155" }}
                                                >
                                                    再試行
                                                </button>
                                            </div>
                                        )}
                                        {light && !light.loading && !light.error && light.changedTableCount === 0 && (
                                            <div style={{ fontSize: 12, color: "#888" }}>テーブル変更なし</div>
                                        )}
                                        {light && !light.loading && !light.error && light.changedTableCount > 0 && (
                                            <>
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                                        <span style={{ fontSize: 11, color: "#666" }}>変更テーブル一覧</span>
                                                        {heavy?.loading && (
                                                            <span style={{ fontSize: 11, color: "#888" }}>件数を集計中...</span>
                                                        )}
                                                        {heavy?.error && (
                                                            <span style={{ fontSize: 11, color: "#92400e" }}>
                                                                ⚠ 件数集計に失敗したため、変更テーブル一覧のみ表示しています。
                                                            </span>
                                                        )}
                                                    </div>
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
                                                        {mergedEntries.map((entry) => {
                                                            const tableKey = `${c.hash}::${entry.table}`;
                                                            const isTableExpanded = expandedTableKey === tableKey;
                                                            return (
                                                                <tr
                                                                    key={entry.table}
                                                                    style={{
                                                                        borderBottom: "1px solid #f0f0f5",
                                                                        cursor: "pointer",
                                                                        background: isTableExpanded ? "#e0e7ff" : undefined,
                                                                    }}
                                                                    onClick={(ev) => {
                                                                        ev.stopPropagation();
                                                                        handleToggleInlineDiff(c.hash, entry.table);
                                                                    }}
                                                                >
                                                                    <td style={{ padding: "3px 8px", fontFamily: "monospace", fontWeight: 500 }}>
                                                                        {entry.table}{isTableExpanded ? " ▲" : " ▶"}
                                                                        {entry.hasSchemaChange && (
                                                                            <span style={{ marginLeft: 8, fontSize: 10, color: "#1d4ed8" }}>schema</span>
                                                                        )}
                                                                    </td>
                                                                    <td style={{ textAlign: "right", padding: "3px 6px", color: "#065f46" }}>
                                                                        {entry.added > 0 ? `+${entry.added}` : "—"}
                                                                    </td>
                                                                    <td style={{ textAlign: "right", padding: "3px 6px", color: "#92400e" }}>
                                                                        {entry.modified > 0 ? `~${entry.modified}` : "—"}
                                                                    </td>
                                                                    <td style={{ textAlign: "right", padding: "3px 6px", color: "#991b1b" }}>
                                                                        {entry.removed > 0 ? `-${entry.removed}` : "—"}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>

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
// Wrapped in memo to prevent re-renders when parent MergeLog state changes
// (e.g. another commit expanded) while this diff's props remain the same.

const InlineDiff = memo(function InlineDiff({
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
});
