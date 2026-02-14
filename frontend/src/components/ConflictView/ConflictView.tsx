import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";
import type { ConflictsSummaryEntry } from "../../types/api";

interface ConflictViewProps {
  expectedHead: string;
  onResolved: (newHash: string) => void;
}

export function ConflictView({ expectedHead, onResolved }: ConflictViewProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const { setBaseState, setError } = useUIStore();
  const [conflicts, setConflicts] = useState<ConflictsSummaryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    loadConflicts();
  }, [targetId, dbName, branchName]);

  const loadConflicts = () => {
    setLoading(true);
    setLoadError(null);
    api
      .getConflicts(targetId, dbName, branchName)
      .then(setConflicts)
      .catch((err) => {
        const e = err as { error?: { message?: string } };
        setLoadError(e?.error?.message || "Failed to load conflicts");
      })
      .finally(() => setLoading(false));
  };

  const handleResolve = async (table: string, strategy: "ours" | "theirs") => {
    setResolving(true);
    setBaseState("Syncing");
    try {
      const result = await api.resolveConflicts({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        expected_head: expectedHead,
        table,
        strategy,
      });
      setBaseState("Idle");
      onResolved(result.hash);
    } catch (err: unknown) {
      const e = err as { error?: { code?: string; message?: string } };
      if (e?.error?.code === "SCHEMA_CONFLICTS_PRESENT") {
        setBaseState("SchemaConflictDetected");
        setError("Schema conflicts detected. Resolve via CLI.");
      } else if (e?.error?.code === "CONSTRAINT_VIOLATIONS_PRESENT") {
        setBaseState("ConstraintViolationDetected");
        setError("Constraint violations detected. Resolve via CLI.");
      } else {
        setBaseState("MergeConflictsPresent");
        setError(e?.error?.message || "Resolution failed");
      }
    } finally {
      setResolving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, textAlign: "center" }}>Loading conflicts...</div>;
  }

  if (loadError) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <div className="error-banner" style={{ display: "inline-flex", borderRadius: 6, borderBottom: "none" }}>
          {loadError}
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={loadConflicts}>Retry</button>
        </div>
      </div>
    );
  }

  if (conflicts.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "#888" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>&#x2714;</div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>No conflicts detected</div>
        <div style={{ fontSize: 12 }}>
          Conflicts appear here after a Sync from Main if there are overlapping changes.
          You can safely continue editing.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
        Merge Conflicts
      </h3>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #d0d0d8" }}>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Table</th>
            <th style={{ textAlign: "center", padding: "6px 8px" }}>
              Schema
            </th>
            <th style={{ textAlign: "center", padding: "6px 8px" }}>Data</th>
            <th style={{ textAlign: "center", padding: "6px 8px" }}>
              Constraints
            </th>
            <th style={{ textAlign: "right", padding: "6px 8px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {conflicts.map((c) => (
            <tr
              key={c.table}
              style={{ borderBottom: "1px solid #e8e8f0" }}
            >
              <td style={{ padding: "6px 8px", fontWeight: 500 }}>
                {c.table}
              </td>
              <td style={{ textAlign: "center", padding: "6px 8px" }}>
                {c.schema_conflicts > 0 ? (
                  <span className="badge badge-danger">
                    {c.schema_conflicts}
                  </span>
                ) : (
                  "-"
                )}
              </td>
              <td style={{ textAlign: "center", padding: "6px 8px" }}>
                {c.data_conflicts > 0 ? (
                  <span className="badge badge-warning">
                    {c.data_conflicts}
                  </span>
                ) : (
                  "-"
                )}
              </td>
              <td style={{ textAlign: "center", padding: "6px 8px" }}>
                {c.constraint_violations > 0 ? (
                  <span className="badge badge-danger">
                    {c.constraint_violations}
                  </span>
                ) : (
                  "-"
                )}
              </td>
              <td style={{ textAlign: "right", padding: "6px 8px" }}>
                {c.data_conflicts > 0 && c.schema_conflicts === 0 ? (
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => handleResolve(c.table, "ours")}
                      disabled={resolving}
                      style={{ fontSize: 11 }}
                    >
                      Keep Ours
                    </button>
                    <button
                      onClick={() => handleResolve(c.table, "theirs")}
                      disabled={resolving}
                      style={{ fontSize: 11 }}
                    >
                      Keep Theirs
                    </button>
                  </div>
                ) : (
                  <span style={{ fontSize: 11, color: "#888" }}>
                    CLI required
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
