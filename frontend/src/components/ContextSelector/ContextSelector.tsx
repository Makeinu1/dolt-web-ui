import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";
import type { Target, Database, Branch } from "../../types/api";

export function ContextSelector() {
  const { targetId, dbName, branchName, setTarget, setDatabase, setBranch } =
    useContextStore();

  const [targets, setTargets] = useState<Target[]>([]);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    api.getTargets().then(setTargets).catch(console.error);
  }, []);

  useEffect(() => {
    if (!targetId) {
      setDatabases([]);
      return;
    }
    api.getDatabases(targetId).then(setDatabases).catch(console.error);
  }, [targetId]);

  useEffect(() => {
    if (!targetId || !dbName) {
      setBranches([]);
      return;
    }
    api.getBranches(targetId, dbName).then(setBranches).catch(console.error);
  }, [targetId, dbName]);

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
        <select
          value={branchName}
          onChange={(e) => setBranch(e.target.value)}
          disabled={!dbName}
        >
          <option value="">-- Select --</option>
          {branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
