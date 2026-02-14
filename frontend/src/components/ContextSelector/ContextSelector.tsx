import { useEffect, useMemo, useState } from "react";
import { useContextStore } from "../../store/context";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";
import type { Target, Database, Branch } from "../../types/api";

export function ContextSelector() {
  const { targetId, dbName, branchName, branchRefreshKey, setTarget, setDatabase, setBranch } =
    useContextStore();
  const setError = useUIStore((s) => s.setError);

  const [targets, setTargets] = useState<Target[]>([]);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [workItemName, setWorkItemName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.getTargets().then(setTargets).catch((err) => {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "Failed to load targets");
    });
  }, []);

  useEffect(() => {
    if (!targetId) {
      setDatabases([]);
      return;
    }
    api.getDatabases(targetId).then(setDatabases).catch((err) => {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "Failed to load databases");
    });
  }, [targetId]);

  const refreshBranches = async () => {
    if (!targetId || !dbName) {
      setBranches([]);
      return;
    }
    try {
      const result = await api.getBranches(targetId, dbName);
      setBranches(result);
    } catch (err) {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "Failed to load branches");
    }
  };

  useEffect(() => {
    refreshBranches();
  }, [targetId, dbName, branchRefreshKey]);

  // Auto-calculate next Round from existing branches for the given WorkItem
  const nextRound = useMemo(() => {
    const trimmed = workItemName.trim();
    if (!trimmed) return "01";
    const existing = branches
      .map((b) => b.name.match(/^wi\/(.+)\/(\d{2})$/))
      .filter(Boolean)
      .filter((m) => m![1] === trimmed)
      .map((m) => parseInt(m![2], 10));
    const max = existing.length > 0 ? Math.max(...existing) : 0;
    return String(max + 1).padStart(2, "0");
  }, [branches, workItemName]);

  const fullBranchName = workItemName.trim()
    ? `wi/${workItemName.trim()}/${nextRound}`
    : "";

  const workItemValid =
    workItemName.trim().length > 0 &&
    /^[A-Za-z0-9._-]+$/.test(workItemName.trim());

  const handleCreateBranch = async () => {
    if (!fullBranchName || !workItemValid) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.createBranch({
        target_id: targetId,
        db_name: dbName,
        branch_name: fullBranchName,
      });
      await refreshBranches();
      setBranch(fullBranchName);
      setWorkItemName("");
      setShowCreate(false);
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setCreateError(e?.error?.message || "Failed to create branch");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteBranch = async () => {
    if (!branchName || branchName === "main") return;
    if (!window.confirm(`Delete branch "${branchName}"?`)) return;
    setDeleting(true);
    try {
      await api.deleteBranch({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
      });
      refreshBranches();
      setBranch("main");
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      alert(e?.error?.message || "Failed to delete branch");
    } finally {
      setDeleting(false);
    }
  };

  const isMain = branchName === "main";

  return (
    <div className="context-bar">
      <div>
        <label>Target</label>
        <select
          value={targetId}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">-- Select --</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>Database</label>
        <select
          value={dbName}
          onChange={(e) => setDatabase(e.target.value)}
          disabled={!targetId}
        >
          <option value="">-- Select --</option>
          {databases.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>Branch</label>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <select
            value={branchName}
            onChange={(e) => setBranch(e.target.value)}
            disabled={!dbName}
          >
            <option value="">-- Select --</option>
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name === "main" ? `\u{1F512} ${b.name}` : b.name}
              </option>
            ))}
          </select>
          {targetId && dbName && (
            <>
              <button
                onClick={() => setShowCreate(!showCreate)}
                style={{ fontSize: 11, padding: "4px 8px", whiteSpace: "nowrap" }}
              >
                + New
              </button>
              {branchName && !isMain && (
                <button
                  onClick={handleDeleteBranch}
                  disabled={deleting}
                  style={{
                    fontSize: 11,
                    padding: "4px 8px",
                    whiteSpace: "nowrap",
                    color: "#991b1b",
                  }}
                >
                  {deleting ? "..." : "Delete"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {showCreate && (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#666" }}>wi /</span>
          <input
            type="text"
            value={workItemName}
            onChange={(e) => setWorkItemName(e.target.value)}
            placeholder="work-item-name"
            style={{ fontSize: 12, padding: "4px 8px", width: 160 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateBranch();
            }}
            autoFocus
          />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#666" }}>/ {nextRound}</span>
          <button
            className="primary"
            onClick={handleCreateBranch}
            disabled={creating || !workItemValid}
            style={{ fontSize: 11, padding: "4px 8px" }}
          >
            {creating ? "..." : "Create"}
          </button>
          <button
            onClick={() => {
              setShowCreate(false);
              setCreateError(null);
              setWorkItemName("");
            }}
            style={{ fontSize: 11, padding: "4px 8px" }}
          >
            Cancel
          </button>
          {workItemName.trim() && !workItemValid && (
            <span style={{ color: "#c00", fontSize: 11 }}>
              A-Z, a-z, 0-9, ., _, - only
            </span>
          )}
          {createError && (
            <span style={{ color: "#c00", fontSize: 11 }}>{createError}</span>
          )}
          {fullBranchName && workItemValid && (
            <span style={{ fontSize: 11, color: "#065f46" }}>
              → {fullBranchName}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
