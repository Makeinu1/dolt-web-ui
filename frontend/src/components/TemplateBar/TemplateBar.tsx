import { useState } from "react";
import { useContextStore } from "../../store/context";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";

interface TemplateBarProps {
  tableName: string;
  pkColumn: string;
}

export function TemplateBar({ tableName, pkColumn }: TemplateBarProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const addOp = useDraftStore((s) => s.addOp);
  const setBaseState = useUIStore((s) => s.setBaseState);
  const baseState = useUIStore((s) => s.baseState);
  const isMain = branchName === "main";

  const [showClone, setShowClone] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [cloneSourcePK, setCloneSourcePK] = useState("");
  const [cloneNewPKs, setCloneNewPKs] = useState("");
  const [tsvData, setTsvData] = useState("");
  const [previewOps, setPreviewOps] = useState<import("../../types/api").CommitOp[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (isMain || !tableName) return null;

  const handleClonePreview = async () => {
    setError(null);
    const newPks = cloneNewPKs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!cloneSourcePK || newPks.length === 0) {
      setError("Source PK and new PKs are required");
      return;
    }
    try {
      setBaseState("Previewing");
      const result = await api.previewClone({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        table: tableName,
        template_pk: { [pkColumn]: cloneSourcePK },
        new_pks: newPks,
      });
      setPreviewOps(result.ops);
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "Preview failed");
      setBaseState("Idle");
    }
  };

  const handleBulkPreview = async () => {
    setError(null);
    if (!tsvData.trim()) {
      setError("TSV data is required");
      return;
    }
    try {
      setBaseState("Previewing");
      const result = await api.previewBulkUpdate({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        table: tableName,
        tsv_data: tsvData,
      });
      setPreviewOps(result.ops);
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "Preview failed");
      setBaseState("Idle");
    }
  };

  const applyPreview = () => {
    for (const op of previewOps) {
      addOp(op);
    }
    setPreviewOps([]);
    setShowClone(false);
    setShowBulk(false);
    setCloneSourcePK("");
    setCloneNewPKs("");
    setTsvData("");
    setBaseState("DraftEditing");
  };

  const cancelPreview = () => {
    setPreviewOps([]);
    setBaseState(
      useDraftStore.getState().ops.length > 0 ? "DraftEditing" : "Idle"
    );
  };

  const disabled = baseState === "Committing" || baseState === "Syncing";

  return (
    <>
      <div className="toolbar">
        <button onClick={() => setShowClone(true)} disabled={disabled}>
          Quick Clone
        </button>
        <button onClick={() => setShowBulk(true)} disabled={disabled}>
          Bulk Update (TSV)
        </button>
      </div>

      {/* Clone Modal */}
      {showClone && (
        <div className="modal-overlay" onClick={() => { setShowClone(false); cancelPreview(); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Quick Clone</h2>
            {error && <div className="error-banner">{error}</div>}
            {previewOps.length === 0 ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
                    Source PK ({pkColumn})
                  </label>
                  <input
                    value={cloneSourcePK}
                    onChange={(e) => setCloneSourcePK(e.target.value)}
                    placeholder="e.g. 100"
                    style={{ width: "100%" }}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
                    New PKs (comma separated)
                  </label>
                  <input
                    value={cloneNewPKs}
                    onChange={(e) => setCloneNewPKs(e.target.value)}
                    placeholder="e.g. 201, 202, 203"
                    style={{ width: "100%" }}
                  />
                </div>
                <div className="modal-actions">
                  <button onClick={() => setShowClone(false)}>Cancel</button>
                  <button className="primary" onClick={handleClonePreview}>
                    Preview
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ marginBottom: 8 }}>
                  {previewOps.length} rows will be inserted:
                </p>
                <div
                  style={{
                    maxHeight: 200,
                    overflow: "auto",
                    background: "#f5f5f8",
                    padding: 8,
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  <pre>{JSON.stringify(previewOps, null, 2)}</pre>
                </div>
                <div className="modal-actions">
                  <button onClick={cancelPreview}>Cancel</button>
                  <button className="success" onClick={applyPreview}>
                    Apply to Draft
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bulk Update Modal */}
      {showBulk && (
        <div className="modal-overlay" onClick={() => { setShowBulk(false); cancelPreview(); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Bulk Update (TSV)</h2>
            {error && <div className="error-banner">{error}</div>}
            {previewOps.length === 0 ? (
              <>
                <p style={{ fontSize: 12, marginBottom: 8, color: "#666" }}>
                  Paste TSV data. First column = PK, first row = header.
                </p>
                <textarea
                  value={tsvData}
                  onChange={(e) => setTsvData(e.target.value)}
                  rows={10}
                  style={{ width: "100%", fontFamily: "monospace" }}
                  placeholder={`${pkColumn}\tcolumn1\tcolumn2\n100\tvalue1\tvalue2`}
                />
                <div className="modal-actions">
                  <button onClick={() => setShowBulk(false)}>Cancel</button>
                  <button className="primary" onClick={handleBulkPreview}>
                    Preview
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ marginBottom: 8 }}>
                  {previewOps.length} rows will be updated:
                </p>
                <div
                  style={{
                    maxHeight: 200,
                    overflow: "auto",
                    background: "#f5f5f8",
                    padding: 8,
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  <pre>{JSON.stringify(previewOps, null, 2)}</pre>
                </div>
                <div className="modal-actions">
                  <button onClick={cancelPreview}>Cancel</button>
                  <button className="success" onClick={applyPreview}>
                    Apply to Draft
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
