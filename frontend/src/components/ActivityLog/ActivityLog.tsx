import { useState, useCallback } from "react";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";
import type { HistoryCommit } from "../../types/api";
import { DiffTableDetail } from "../common/DiffTableDetail";

// ─── ActivityLog モーダル ──────────────────────────────────────────────────────
//
// UC2: キーワード（PJ番号等）でマージログを検索 → Diff展開
// UC3: 期間フィルタで main のマージ一覧を確認
// main ブランチを対象に "merges_only" で検索するのがデフォルト。
// ユーザーが全ブランチに切り替えることも可能。

interface Props {
    onClose: () => void;
}

export function ActivityLog({ onClose }: Props) {
    const { targetId, dbName, branchName } = useContextStore();

    const [keyword, setKeyword] = useState("");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [searchBranch, setSearchBranch] = useState("main");
    const [commits, setCommits] = useState<HistoryCommit[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);

    // 展開中コミット → Diff対象テーブル一覧
    const [expandedHash, setExpandedHash] = useState<string | null>(null);

    const handleSearch = useCallback(async () => {
        if (!targetId || !dbName) return;
        setLoading(true);
        setSearched(false);
        setExpandedHash(null);
        try {
            const branch = searchBranch || branchName || "main";
            const filter = searchBranch === "main" ? "merges_only" : "";
            const result = await api.getHistoryCommits(
                targetId,
                dbName,
                branch,
                1,
                50,
                filter,
                keyword,
                fromDate,
                toDate
            );
            setCommits(result || []);
            setSearched(true);
        } catch {
            setCommits([]);
            setSearched(true);
        } finally {
            setLoading(false);
        }
    }, [targetId, dbName, branchName, searchBranch, keyword, fromDate, toDate]);

    // Enter キーで検索
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleSearch();
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
                    <h2 style={{ margin: 0, fontSize: 16 }}>📜 変更ログ検索</h2>
                    <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#666" }}>✕</button>
                </div>

                {/* 検索フォーム */}
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
                    {/* キーワード */}
                    <div style={{ flex: "2 1 200px" }}>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3, color: "#555" }}>
                            キーワード（コミットメッセージ）
                        </label>
                        <input
                            type="text"
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="例: TR-9999"
                            style={{ width: "100%", fontSize: 13, padding: "4px 8px", boxSizing: "border-box" }}
                        />
                    </div>

                    {/* ブランチ */}
                    <div style={{ flex: "1 1 120px" }}>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3, color: "#555" }}>
                            ブランチ
                        </label>
                        <select
                            value={searchBranch}
                            onChange={(e) => setSearchBranch(e.target.value)}
                            style={{ width: "100%", fontSize: 13, padding: "4px 8px" }}
                        >
                            <option value="main">main（マージ単位）</option>
                            <option value={branchName || "main"}>現在のブランチ</option>
                        </select>
                    </div>

                    {/* 期間 */}
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
                        onClick={handleSearch}
                        disabled={loading}
                        style={{ padding: "5px 16px", fontSize: 13, alignSelf: "flex-end" }}
                    >
                        {loading ? "検索中..." : "🔍 検索"}
                    </button>
                </div>

                {/* 結果 */}
                <div style={{ flex: 1, overflowY: "auto" }}>
                    {!searched && !loading && (
                        <div style={{ textAlign: "center", color: "#888", padding: 32, fontSize: 13 }}>
                            キーワードや期間を指定して検索してください。
                        </div>
                    )}

                    {searched && commits.length === 0 && (
                        <div style={{ textAlign: "center", color: "#888", padding: 32, fontSize: 13 }}>
                            該当するコミットがありません。
                        </div>
                    )}

                    {commits.map((c) => {
                        const isExpanded = expandedHash === c.hash;
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
                                    onClick={() => setExpandedHash(isExpanded ? null : c.hash)}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", marginBottom: 2 }}>
                                            {firstLine}
                                        </div>
                                        {rest && (
                                            <div style={{ fontSize: 11, color: "#555", whiteSpace: "pre-wrap" }}>{rest}</div>
                                        )}
                                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                                            <code style={{ fontSize: 10, background: "#f1f5f9", padding: "1px 4px", borderRadius: 3 }}>
                                                {c.hash.slice(0, 8)}
                                            </code>
                                            {" "}📅 {c.timestamp
                                                ? new Date(c.timestamp).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
                                                : ""}
                                            {c.author ? ` 👤 ${c.author}` : ""}
                                        </div>
                                    </div>
                                    <span style={{ fontSize: 12, color: "#3b82f6", marginLeft: 8, flexShrink: 0 }}>
                                        {isExpanded ? "▲ 閉じる" : "▶ Diff"}
                                    </span>
                                </div>

                                {/* Diff展開: コミットハッシュの前の親との diff */}
                                {isExpanded && (
                                    <div style={{
                                        borderTop: "1px solid #e2e8f0",
                                        padding: "8px 12px",
                                        background: "#f8fafc",
                                        maxHeight: 400,
                                        overflowY: "auto",
                                    }}>
                                        <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>
                                            変更差分（このコミット vs 親コミット）:
                                        </div>
                                        <DiffTableDetail
                                            table=""
                                            targetId={targetId}
                                            dbName={dbName}
                                            branchName={searchBranch || branchName || "main"}
                                            fromRef={`${c.hash}^`}
                                            toRef={c.hash}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
