import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";
import { ApiError } from "../../api/errors";
import type { Target, Database, Branch } from "../../types/api";

const branchSwitchDiscardMessage = "未コミットの変更があります。破棄して既存の作業ブランチを開きますか？";

function getBranchErrorDetails(err: ApiError): { branch_name?: string; retry_after_ms?: number } {
  if (!err.details || typeof err.details !== "object") {
    return {};
  }
  const details = err.details as Record<string, unknown>;
  return {
    branch_name: typeof details.branch_name === "string" ? details.branch_name : undefined,
    retry_after_ms:
      typeof details.retry_after_ms === "number" ? details.retry_after_ms : undefined,
  };
}

export function ContextSelector() {
  const { targetId, dbName, branchName, branchRefreshKey, setTarget, setDatabase, setBranch } =
    useContextStore();
  const setError = useUIStore((s) => s.setError);
  const hasDraft = useDraftStore((s) => s.hasDraft);

  const [targets, setTargets] = useState<Target[]>([]);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [workItemName, setWorkItemName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    api.getTargets().then(setTargets).catch((err) => {
      setError(err instanceof ApiError ? err.message : "ターゲットの読み込みに失敗しました");
    });
  }, []);

  useEffect(() => {
    if (!targetId) {
      setDatabases([]);
      return;
    }
    api.getDatabases(targetId).then(setDatabases).catch((err) => {
      setError(err instanceof ApiError ? err.message : "データベースの読み込みに失敗しました");
    });
  }, [targetId]);

  const refreshBranches = async (): Promise<Branch[]> => {
    if (!targetId || !dbName) {
      setBranches([]);
      return [];
    }
    setLoadingBranches(true);
    try {
      const result = await api.getBranches(targetId, dbName);
      setBranches(result);
      // Reset branch selection if current branch no longer exists (e.g. after approve/delete)
      const currentBranch = useContextStore.getState().branchName;
      if (currentBranch && !result.some((b) => b.name === currentBranch)) {
        setBranch("");
      }
      return result;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ブランチの読み込みに失敗しました");
      throw err;
    } finally {
      setLoadingBranches(false);
    }
  };

  useEffect(() => {
    refreshBranches().catch(() => undefined);
  }, [targetId, dbName, branchRefreshKey]);

  // コンテキスト切替時にブランチ作成フォームをリセット
  useEffect(() => {
    setShowCreate(false);
    setWorkItemName("");
    setCreateError(null);
  }, [targetId, dbName]);

  const fullBranchName = workItemName.trim()
    ? `wi/${workItemName.trim()}`
    : "";

  const workItemValid =
    workItemName.trim().length > 0 &&
    /^[A-Za-z0-9._-]+$/.test(workItemName.trim());

  const openExistingBranch = async (existingBranchName: string) => {
    const latestBranches = await refreshBranches();
    if (!latestBranches.some((branch) => branch.name === existingBranchName)) {
      return false;
    }
    if (hasDraft() && !window.confirm(branchSwitchDiscardMessage)) {
      return true;
    }
    setBranch(existingBranchName);
    setWorkItemName("");
    setShowCreate(false);
    setCreateError(null);
    return true;
  };

  const waitForBranchReady = async (readyBranchName: string, retryAfterMs = 2000) => {
    const attempts = Math.max(1, Math.ceil(retryAfterMs / 400));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const latestBranches = await refreshBranches();
        if (latestBranches.some((branch) => branch.name === readyBranchName)) {
          await api.getHead(targetId, dbName, readyBranchName);
          setBranch(readyBranchName);
          setWorkItemName("");
          setShowCreate(false);
          setCreateError(null);
          return true;
        }
      } catch {
        // Keep polling until the branch becomes queryable or the timeout expires.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
    return false;
  };

  const handleCreateBranch = async () => {
    if (!fullBranchName || !workItemValid) return;
    setCreating(true);
    setCreateError(null);
    try {
      if (branches.some((branch) => branch.name === fullBranchName)) {
        const opened = await openExistingBranch(fullBranchName);
        if (opened) {
          return;
        }
      }

      await api.createBranch({
        target_id: targetId,
        db_name: dbName,
        branch_name: fullBranchName,
      });
      const refreshedBranches = await refreshBranches();
      if (!refreshedBranches.some((branch) => branch.name === fullBranchName)) {
        const ready = await waitForBranchReady(fullBranchName);
        if (!ready) {
          setCreateError("ブランチは作成されましたが、一覧への反映を確認できませんでした。時間をおいて再度開いてください。");
        }
        return;
      }
      setBranch(fullBranchName);
      setWorkItemName("");
      setShowCreate(false);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === "BRANCH_EXISTS") {
        const details = getBranchErrorDetails(err);
        const branchToOpen = details.branch_name ?? fullBranchName;
        const opened = await openExistingBranch(branchToOpen);
        if (!opened) {
          setCreateError(err.message);
        }
      } else if (err instanceof ApiError && err.code === "BRANCH_NOT_READY") {
        const details = getBranchErrorDetails(err);
        const branchToOpen = details.branch_name ?? fullBranchName;
        const ready = await waitForBranchReady(branchToOpen, details.retry_after_ms);
        if (!ready) {
          setCreateError(err.message);
        }
      } else {
        setCreateError(err instanceof ApiError ? err.message : "ブランチの作成に失敗しました");
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="context-bar">
      {/* Active Target/DB clickable text */}
      <div
        onClick={() => setShowSettings(true)}
        style={{
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 13,
          color: targetId && dbName ? "#fff" : "#f59e0b",
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginRight: 8,
        }}
        title="設定 (ターゲット / データベース)"
      >
        {targetId && dbName ? `${dbName}@${targetId}` : "⚙ 接続設定"}
        <span style={{ fontSize: 10, color: "#888" }}>▼</span>
      </div>

      {/* Branch Dropdown */}
      {targetId && dbName && (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <select
            value={branchName}
            onChange={(e) => {
              if (hasDraft() && !window.confirm("未コミットの変更があります。破棄してブランチを切り替えますか？")) return;
              setBranch(e.target.value);
            }}
            style={{ minWidth: 120 }}
            disabled={loadingBranches}
          >
            {loadingBranches ? (
              <option>読み込み中...</option>
            ) : (
              <>
                <option value="">-- ブランチ --</option>
                {branches.map((b) => {
                  const icon = b.name === "main" ? "🔒" : b.name === "audit" ? "📋" : "🌿";
                  return (
                    <option key={b.name} value={b.name}>
                      {`${icon} ${b.name}`}
                    </option>
                  );
                })}
              </>
            )}
          </select>

          <button
            onClick={() => setShowCreate(!showCreate)}
            style={{ fontSize: 12, padding: "3px 8px", background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer" }}
            title="作業ブランチを作成"
          >
            +
          </button>

        </div>
      )}

      {/* Inline Create Branch form */}
      {showCreate && targetId && dbName && (
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: 8, background: "#1e293b", padding: "2px 8px", borderRadius: 4, border: "1px solid #334155" }}>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>wi /</span>
          <input
            type="text"
            value={workItemName}
            onChange={(e) => setWorkItemName(e.target.value)}
            placeholder="ticket-123"
            style={{
              fontSize: 12,
              padding: "2px 6px",
              width: 120,
              background: "#fff",
              color: "#000",
              border: workItemName.trim() && !workItemValid ? "1px solid #f87171" : "none",
              borderRadius: 2,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateBranch();
            }}
            title="使用できる文字: A-Z a-z 0-9 . _ -"
            autoFocus
          />
          <button
            onClick={handleCreateBranch}
            disabled={creating || !workItemValid}
            style={{ fontSize: 11, padding: "2px 8px", background: "#10b981", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", marginLeft: 4 }}
          >
            {creating ? "..." : "作成"}
          </button>
          <button
            onClick={() => {
              setShowCreate(false);
              setCreateError(null);
              setWorkItemName("");
            }}
            style={{ fontSize: 11, padding: "2px 8px", background: "transparent", color: "#cbd5e1", border: "none", cursor: "pointer" }}
          >
            キャンセル
          </button>
          {workItemName.trim() && !workItemValid && (
            <span style={{ color: "#fca5a5", fontSize: 10 }}>使用できない文字が含まれています (A-Z a-z 0-9 . _ - のみ)</span>
          )}
          {createError && (
            <span style={{ color: "#fca5a5", fontSize: 10 }}>{createError}</span>
          )}
        </div>
      )}

      {/* Settings Modal (Target / Database) */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 400 }}>
            <h2>⚙ 接続設定</h2>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 600, color: "#555" }}>
                ターゲットサーバー
              </label>
              <select
                value={targetId}
                onChange={(e) => {
                  if (hasDraft() && !window.confirm("未コミットの変更があります。破棄して接続先を変更しますか？")) return;
                  setTarget(e.target.value);
                }}
                style={{ width: "100%", padding: "6px 8px", fontSize: 14, borderRadius: 4, border: "1px solid #cbd5e1" }}
              >
                <option value="">-- ターゲットを選択 --</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>{t.id}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 600, color: "#555" }}>
                データベース
              </label>
              <select
                value={dbName}
                onChange={(e) => {
                  if (hasDraft() && !window.confirm("未コミットの変更があります。破棄してデータベースを変更しますか？")) return;
                  setDatabase(e.target.value);
                }}
                disabled={!targetId}
                style={{ width: "100%", padding: "6px 8px", fontSize: 14, borderRadius: 4, border: "1px solid #cbd5e1" }}
              >
                <option value="">-- データベースを選択 --</option>
                {databases.map((d) => (
                  <option key={d.name} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>

            <div className="modal-actions">
              <button className="primary" onClick={() => setShowSettings(false)} style={{ minWidth: 100 }}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
