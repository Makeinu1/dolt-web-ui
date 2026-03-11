import { useCallback, useEffect, useMemo, useState } from "react";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import * as api from "../../api/client";
import { ApiError } from "../../api/errors";
import type {
  Database,
  Branch,
  CrossCopyPreviewResponse,
  CrossCopyRowsResponse,
} from "../../types/api";
import { getBranchErrorDetails, waitForBranchReady } from "../../utils/branchRecovery";

interface CrossCopyRowsModalProps {
  tableName: string;
  /** JSON-encoded PK strings for each selected row */
  selectedPKs: string[];
  onClose: () => void;
}

type Step = "select" | "preview" | "done";

function sanitizeWorkItemName(value: string): string {
  const sanitized = value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return sanitized || "copy-work";
}

export function CrossCopyRowsModal({
  tableName,
  selectedPKs,
  onClose,
}: CrossCopyRowsModalProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const sourceBranch = branchName;
  const defaultDestWorkItem = useMemo(
    () => sanitizeWorkItemName(`copy-${dbName}-${tableName}`),
    [dbName, tableName]
  );

  const [step, setStep] = useState<Step>("select");
  const [databases, setDatabases] = useState<Database[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [destDB, setDestDB] = useState("");
  const [destBranch, setDestBranch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [destWorkItemName, setDestWorkItemName] = useState(defaultDestWorkItem);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [createBranchError, setCreateBranchError] = useState<string | null>(null);
  const [createBranchInfo, setCreateBranchInfo] = useState<string | null>(null);
  const [switchingContext, setSwitchingContext] = useState(false);

  // Preview data
  const [preview, setPreview] = useState<CrossCopyPreviewResponse | null>(null);

  // Result data
  const [result, setResult] = useState<CrossCopyRowsResponse | null>(null);

  const fullDestBranchName = destWorkItemName.trim() ? `wi/${destWorkItemName.trim()}` : "";
  const destWorkItemValid =
    destWorkItemName.trim().length > 0 &&
    /^[A-Za-z0-9._-]+$/.test(destWorkItemName.trim());

  const refreshDestBranches = useCallback(async (preferredBranchName?: string): Promise<Branch[]> => {
    if (!destDB) {
      setBranches([]);
      setDestBranch("");
      return [];
    }
    try {
      const brs = await api.getBranches(targetId, destDB);
      const wiBranches = brs
        .filter((branch) => branch.name.startsWith("wi/"))
        .sort((a, b) => a.name.localeCompare(b.name));
      setBranches(wiBranches);
      setDestBranch((current) => {
        if (preferredBranchName && wiBranches.some((branch) => branch.name === preferredBranchName)) {
          return preferredBranchName;
        }
        if (current && wiBranches.some((branch) => branch.name === current)) {
          return current;
        }
        return wiBranches[0]?.name ?? "";
      });
      return wiBranches;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ブランチの読み込みに失敗しました");
      throw err;
    }
  }, [destDB, targetId]);

  // Load databases on mount
  useEffect(() => {
    api
      .getDatabases(targetId)
      .then((dbs) => {
        const filtered = dbs.filter((d) => d.name !== dbName);
        setDatabases(filtered);
        if (filtered.length > 0) setDestDB(filtered[0].name);
      })
      .catch(() => setError("データベースの読み込みに失敗しました"));
  }, [targetId, dbName]);

  // Load branches when destDB changes
  useEffect(() => {
    refreshDestBranches().catch(() => undefined);
    setCreateBranchError(null);
    setCreateBranchInfo(null);
  }, [refreshDestBranches]);

  useEffect(() => {
    setDestWorkItemName(defaultDestWorkItem);
  }, [defaultDestWorkItem]);

  const selectExistingDestBranch = async (existingBranchName: string) => {
    refreshDestBranches(existingBranchName).catch(() => undefined);
    setCreateBranchInfo("既存ブランチの接続反映を確認しています...");
    const ready = await waitForBranchReady({
      targetId,
      dbName: destDB,
      branchName: existingBranchName,
      refreshBranches: () => refreshDestBranches(existingBranchName),
    });
    if (!ready) {
      setCreateBranchInfo(null);
      return false;
    }
    setDestBranch(existingBranchName);
    setCreateBranchError(null);
    setCreateBranchInfo(null);
    return true;
  };

  const handleCreateDestBranch = async () => {
    if (!destDB || !fullDestBranchName || !destWorkItemValid) return;
    setCreatingBranch(true);
    setCreateBranchError(null);
    setCreateBranchInfo(null);
    try {
      if (branches.some((branch) => branch.name === fullDestBranchName)) {
        const opened = await selectExistingDestBranch(fullDestBranchName);
        if (!opened) {
          setCreateBranchError("既存ブランチの接続反映を確認できませんでした。時間をおいて再度開いてください。");
        }
        return;
      }

      await api.createBranch({
        target_id: targetId,
        db_name: destDB,
        branch_name: fullDestBranchName,
      });
      setCreateBranchInfo("ブランチの接続反映を確認しています...");
      const ready = await waitForBranchReady({
        targetId,
        dbName: destDB,
        branchName: fullDestBranchName,
        refreshBranches: () => refreshDestBranches(fullDestBranchName),
      });
      if (!ready) {
        setCreateBranchInfo(null);
        setCreateBranchError("ブランチは作成されましたが、接続反映を確認できませんでした。時間をおいて再度開いてください。");
        return;
      }
      setDestBranch(fullDestBranchName);
      setCreateBranchInfo(null);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === "BRANCH_EXISTS") {
        const details = getBranchErrorDetails(err);
        const branchToOpen = details.branchName ?? fullDestBranchName;
        const opened = await selectExistingDestBranch(branchToOpen);
        if (!opened) {
          setCreateBranchInfo(null);
          setCreateBranchError(err.message);
        }
      } else if (err instanceof ApiError && err.code === "BRANCH_NOT_READY") {
        const details = getBranchErrorDetails(err);
        const branchToOpen = details.branchName ?? fullDestBranchName;
        setCreateBranchInfo("ブランチの接続反映を確認しています...");
        const ready = await waitForBranchReady({
          targetId,
          dbName: destDB,
          branchName: branchToOpen,
          refreshBranches: () => refreshDestBranches(branchToOpen),
          retryAfterMs: details.retryAfterMs,
        });
        if (!ready) {
          setCreateBranchInfo(null);
          setCreateBranchError(err.message);
        } else {
          setDestBranch(branchToOpen);
          setCreateBranchInfo(null);
        }
      } else {
        setCreateBranchInfo(null);
        setCreateBranchError(err instanceof ApiError ? err.message : "ブランチの作成に失敗しました");
      }
    } finally {
      setCreatingBranch(false);
    }
  };

  const handlePreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.crossCopyPreview({
        target_id: targetId,
        source_db: dbName,
        source_branch: sourceBranch,
        source_table: tableName,
        source_pks: selectedPKs,
        dest_db: destDB,
        dest_branch: destBranch,
      });
      setPreview(res);
      setStep("preview");
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError ? err.message : "プレビューに失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.crossCopyRows({
        target_id: targetId,
        source_db: dbName,
        source_branch: sourceBranch,
        source_table: tableName,
        source_pks: selectedPKs,
        dest_db: destDB,
        dest_branch: destBranch,
      });
      setResult(res);
      setStep("done");
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError ? err.message : "コピーに失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchContext = async () => {
    if (useDraftStore.getState().hasDraft()) {
      if (!window.confirm("未保存の変更があります。破棄して切り替えますか？")) return;
    }
    setSwitchingContext(true);
    setError(null);
    const ready = await waitForBranchReady({
      targetId,
      dbName: destDB,
      branchName: destBranch,
      refreshBranches: () => refreshDestBranches(destBranch),
    });
    if (!ready) {
      setSwitchingContext(false);
      setError("宛先ブランチの接続反映を確認できませんでした。時間をおいて再度開いてください。");
      return;
    }
    const ctx = useContextStore.getState();
    ctx.setDatabase(destDB);
    useContextStore.getState().setBranch(destBranch);
    setSwitchingContext(false);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ minWidth: 600, maxWidth: 900, maxHeight: "80vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>他DBへコピー</h2>
          <button
            onClick={onClose}
            style={{
              fontSize: 18,
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {/* Source info */}
        <div
          style={{
            fontSize: 12,
            color: "#666",
            marginBottom: 12,
            padding: "4px 8px",
            background: "#f8fafc",
            borderRadius: 4,
          }}
        >
          コピー元: {dbName} / {sourceBranch} / {tableName} ({selectedPKs.length}
          件)
        </div>

        {error && (
          <div
            style={{
              padding: "6px 10px",
              background: "#fee2e2",
              color: "#991b1b",
              fontSize: 12,
              borderRadius: 4,
              marginBottom: 8,
            }}
          >
            {error}
          </div>
        )}

        {/* Step 1: Select destination */}
        {step === "select" && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                宛先DB
              </label>
              <select
                value={destDB}
                onChange={(e) => setDestDB(e.target.value)}
                style={{ width: "100%", padding: "4px 8px", fontSize: 13 }}
              >
                {databases.length === 0 && (
                  <option value="">他のDBがありません</option>
                )}
                {databases.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                宛先ブランチ
              </label>
              <select
                value={destBranch}
                onChange={(e) => setDestBranch(e.target.value)}
                style={{ width: "100%", padding: "4px 8px", fontSize: 13 }}
              >
                {branches.length === 0 && (
                  <option value="">wi/* ブランチがありません</option>
                )}
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {destDB && branches.length === 0 && (
              <div
                style={{
                  marginBottom: 16,
                  padding: "10px 12px",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "#1d4ed8", marginBottom: 8 }}>
                  宛先DBに作業ブランチがありません
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "#64748b" }}>wi /</span>
                  <input
                    type="text"
                    value={destWorkItemName}
                    onChange={(e) => setDestWorkItemName(e.target.value)}
                    placeholder={defaultDestWorkItem}
                    style={{
                      flex: 1,
                      fontSize: 12,
                      padding: "4px 8px",
                      border: destWorkItemName.trim() && !destWorkItemValid ? "1px solid #f87171" : "1px solid #cbd5e1",
                      borderRadius: 4,
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handleCreateDestBranch();
                      }
                    }}
                  />
                  <button
                    className="primary"
                    onClick={() => void handleCreateDestBranch()}
                    disabled={creatingBranch || !destWorkItemValid}
                    style={{ padding: "6px 12px", fontSize: 12 }}
                  >
                    {creatingBranch ? "作成中..." : "作業ブランチを作成"}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: "#475569" }}>
                  推奨名: <code>{`wi/${defaultDestWorkItem}`}</code>
                </div>
                {destWorkItemName.trim() && !destWorkItemValid && (
                  <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 6 }}>
                    使用できる文字は A-Z a-z 0-9 . _ - のみです
                  </div>
                )}
                {createBranchError && (
                  <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 6 }}>
                    {createBranchError}
                  </div>
                )}
                {createBranchInfo && (
                  <div style={{ fontSize: 11, color: "#1d4ed8", marginTop: 6 }}>
                    {createBranchInfo}
                  </div>
                )}
              </div>
            )}

            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button
                onClick={onClose}
                style={{
                  padding: "6px 16px",
                  fontSize: 13,
                  background: "#f1f5f9",
                  color: "#334155",
                  border: "1px solid #cbd5e1",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                キャンセル
              </button>
              <button
                className="primary"
                onClick={handlePreview}
                disabled={
                  loading || !destDB || !destBranch || databases.length === 0
                }
                style={{ padding: "6px 16px", fontSize: 13 }}
              >
                {loading ? "読み込み中..." : "プレビュー"}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === "preview" && preview && (
          <div>
            {/* Column info */}
            <div
              style={{
                fontSize: 12,
                marginBottom: 8,
                padding: "6px 8px",
                background: "#f0fdf4",
                borderRadius: 4,
              }}
            >
              共有カラム: {preview.shared_columns.join(", ")}
            </div>

            {/* Auto-expand columns notification */}
            {preview.expand_columns && preview.expand_columns.length > 0 && (
              <div style={{ fontSize: 12, marginBottom: 4, padding: "6px 8px", background: "#eff6ff", color: "#1d4ed8", borderRadius: 4, border: "1px solid #bfdbfe" }}>
                以下のカラムを自動拡張します（DDL）:
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  {preview.expand_columns.map((ec, i) => (
                    <li key={i}><strong>{ec.name}</strong>: {ec.dst_type} → {ec.src_type}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warnings */}
            {preview.warnings.map((w, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  marginBottom: 4,
                  padding: "4px 8px",
                  background: "#fffbeb",
                  color: "#92400e",
                  borderRadius: 4,
                }}
              >
                {w}
              </div>
            ))}

            {/* Row table */}
            <div
              style={{
                marginTop: 8,
                maxHeight: "40vh",
                overflow: "auto",
                border: "1px solid #e2e8f0",
                borderRadius: 4,
              }}
            >
              <table
                style={{
                  width: "100%",
                  fontSize: 12,
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                    <th
                      style={{
                        padding: "4px 8px",
                        textAlign: "left",
                        borderBottom: "1px solid #e2e8f0",
                        fontWeight: 600,
                      }}
                    >
                      操作
                    </th>
                    {preview.shared_columns.map((col) => (
                      <th
                        key={col}
                        style={{
                          padding: "4px 8px",
                          textAlign: "left",
                          borderBottom: "1px solid #e2e8f0",
                          fontWeight: 600,
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr
                      key={i}
                      style={{
                        background:
                          row.action === "insert" ? "#f0fdf4" : "#fffbeb",
                      }}
                    >
                      <td
                        style={{
                          padding: "4px 8px",
                          borderBottom: "1px solid #f1f5f9",
                          fontWeight: 600,
                          color:
                            row.action === "insert" ? "#166534" : "#92400e",
                        }}
                      >
                        {row.action === "insert" ? "INSERT" : "UPDATE"}
                      </td>
                      {preview.shared_columns.map((col) => {
                        const srcVal = String(row.source_row[col] ?? "");
                        const dstVal = row.dest_row
                          ? String(row.dest_row[col] ?? "")
                          : "";
                        const changed =
                          row.action === "update" && srcVal !== dstVal;
                        return (
                          <td
                            key={col}
                            style={{
                              padding: "4px 8px",
                              borderBottom: "1px solid #f1f5f9",
                              background: changed ? "#fef3c7" : undefined,
                            }}
                          >
                            {changed ? (
                              <span>
                                <span
                                  style={{
                                    textDecoration: "line-through",
                                    color: "#9ca3af",
                                    marginRight: 4,
                                  }}
                                >
                                  {dstVal}
                                </span>
                                <span style={{ color: "#92400e" }}>
                                  {srcVal}
                                </span>
                              </span>
                            ) : (
                              srcVal
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 12,
              }}
            >
              <button
                onClick={() => {
                  setStep("select");
                  setPreview(null);
                }}
                style={{
                  padding: "6px 16px",
                  fontSize: 13,
                  background: "#f1f5f9",
                  color: "#334155",
                  border: "1px solid #cbd5e1",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                戻る
              </button>
              <button
                className="primary"
                onClick={handleExecute}
                disabled={loading || preview.rows.length === 0}
                style={{ padding: "6px 16px", fontSize: 13 }}
              >
                {loading
                  ? "コピー中..."
                  : `コピー実行 (${preview.rows.length}件)`}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === "done" && result && (
          <div>
            <div
              style={{
                padding: "12px 16px",
                background: "#f0fdf4",
                borderRadius: 4,
                marginBottom: 12,
                fontSize: 13,
                color: "#166534",
              }}
            >
              {result.total}件コピーしました（挿入: {result.inserted}, 更新:{" "}
              {result.updated}）
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={onClose}
                style={{
                  padding: "6px 16px",
                  fontSize: 13,
                  background: "#f1f5f9",
                  color: "#334155",
                  border: "1px solid #cbd5e1",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                閉じる
              </button>
              <button
                className="primary"
                onClick={() => void handleSwitchContext()}
                disabled={switchingContext}
                style={{ padding: "6px 16px", fontSize: 13 }}
              >
                {switchingContext ? "接続反映待ち..." : "宛先に切り替え"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
