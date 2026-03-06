import { ApproverInbox, SubmitDialog } from "../RequestDialog/RequestDialog";
import { CommitDialog } from "../common/CommitDialog";
import { HistoryTab } from "../HistoryTab/HistoryTab";
import { CellCommentPanel } from "../CellCommentPanel/CellCommentPanel";
import { MergeLog } from "../MergeLog/MergeLog";
import type { SelectedCellInfo } from "../TableGrid/TableGrid";
import type { OverwrittenTable } from "../../types/api";


// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModalManagerProps {
    // Context
    targetId: string;
    dbName: string;
    branchName: string;
    expectedHead: string;

    // Visibility flags
    showCommit: boolean;
    showSubmit: boolean;
    showApprover: boolean;
    showHistory: boolean;
    showDeleteConfirm: boolean;
    showCommentPanel: boolean;
    showMergeLog: boolean;

    // Closers
    onCloseCommit: () => void;
    onCloseSubmit: () => void;
    onCloseApprover: () => void;
    onCloseHistory: () => void;
    onCloseDeleteConfirm: () => void;
    onCloseCommentPanel: () => void;
    onCloseMergeLog: () => void;
    onPreviewCommit?: (hash: string, label: string) => void; // 2c
    mergeLogFilterTable?: string;
    mergeLogFilterPk?: string;

    // Callbacks
    onCommitSuccess: (newHash: string) => void;
    onSubmitted: (overwrittenTables?: OverwrittenTable[]) => void;
    onDeleteConfirm: () => void;

    // State
    deleting: boolean;
    selectedCell: SelectedCellInfo | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * C-2: ModalManager
 *
 * Aggregates all 6 modal/panel renderings that were previously inline in
 * App.tsx, reducing App.tsx by ~90 lines and keeping modal logic co-located.
 */
export function ModalManager({
    targetId,
    dbName,
    branchName,
    expectedHead,
    showCommit,
    showSubmit,
    showApprover,
    showHistory,
    showDeleteConfirm,
    showCommentPanel,
    showMergeLog,
    onCloseCommit,
    onCloseSubmit,
    onCloseApprover,
    onCloseHistory,
    onCloseDeleteConfirm,
    onCloseCommentPanel,
    onCloseMergeLog,
    onCommitSuccess,
    onSubmitted,
    onDeleteConfirm,
    deleting,
    selectedCell,
    onPreviewCommit,
    mergeLogFilterTable,
    mergeLogFilterPk,
}: ModalManagerProps) {
    return (
        <>
            {/* Commit Dialog */}
            {showCommit && (
                <CommitDialog
                    expectedHead={expectedHead}
                    onClose={onCloseCommit}
                    onCommitSuccess={onCommitSuccess}
                />
            )}

            {/* Submit Dialog */}
            {showSubmit && (
                <SubmitDialog
                    expectedHead={expectedHead}
                    onClose={onCloseSubmit}
                    onSubmitted={onSubmitted}
                />
            )}

            {/* Approver Inbox */}
            {showApprover && (
                <div className="modal-overlay" onClick={onCloseApprover}>
                    <div className="modal" style={{ minWidth: 700, maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                            <h2 style={{ margin: 0 }}>承認待ちリクエスト</h2>
                            <button onClick={onCloseApprover} style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer" }}>✕</button>
                        </div>
                        <ApproverInbox />
                    </div>
                </div>
            )}

            {/* History / Version Compare */}
            {showHistory && (
                <div className="modal-overlay" onClick={onCloseHistory}>
                    <div className="modal" style={{ minWidth: 700, maxWidth: 900, maxHeight: "80vh" }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                            <h2 style={{ margin: 0 }}>バージョン比較</h2>
                            <button onClick={onCloseHistory} style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer" }}>✕</button>
                        </div>
                        <HistoryTab />
                    </div>
                </div>
            )}

            {/* Delete Branch Confirmation */}
            {showDeleteConfirm && (
                <div className="modal-overlay" onClick={onCloseDeleteConfirm}>
                    <div className="modal" style={{ minWidth: 380, maxWidth: 450 }} onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>ブランチの削除</h2>
                        <p style={{ fontSize: 13, color: "#555", margin: "0 0 16px" }}>
                            ブランチ{" "}
                            <code style={{ fontSize: 12, background: "#f1f5f9", padding: "1px 4px", borderRadius: 2 }}>
                                {branchName}
                            </code>{" "}
                            を完全に削除します。この操作は元に戻せません。
                        </p>
                        <div className="modal-actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button
                                onClick={onCloseDeleteConfirm}
                                style={{ padding: "6px 16px", fontSize: 13, background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer" }}
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={onDeleteConfirm}
                                disabled={deleting}
                                style={{ padding: "6px 16px", fontSize: 13, background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                            >
                                {deleting ? "削除中..." : "削除する"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cell Memo Panel (slide-in) */}
            {showCommentPanel && selectedCell && (
                <CellCommentPanel
                    targetId={targetId}
                    dbName={dbName}
                    branchName={branchName}
                    table={selectedCell.table}
                    pk={selectedCell.pk}
                    column={selectedCell.column}
                    onClose={onCloseCommentPanel}
                />
            )}

            {/* Merge Log Modal */}
            {showMergeLog && (
                <MergeLog
                    onClose={onCloseMergeLog}
                    onPreviewCommit={onPreviewCommit}
                    filterTable={mergeLogFilterTable}
                    filterPk={mergeLogFilterPk}
                />
            )}
        </>
    );
}
