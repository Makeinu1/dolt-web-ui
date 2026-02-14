import { useState } from "react";
import { useContextStore } from "../../store/context";
import { useTemplateStore } from "../../store/template";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";
import type { CommitOp, PreviewError } from "../../types/api";

interface BatchGenerateModalProps {
  onClose: () => void;
}

export function BatchGenerateModal({ onClose }: BatchGenerateModalProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const { templateRow, templateTable, templateColumns, changeColumn } = useTemplateStore();
  const addOp = useDraftStore((s) => s.addOp);
  const setBaseState = useUIStore((s) => s.setBaseState);
  const toggleDrawer = useUIStore((s) => s.toggleDrawer);

  const pkCol = templateColumns.find((c) => c.primary_key);

  const [pkListText, setPkListText] = useState("");
  const [valuesText, setValuesText] = useState("");
  const [previewOps, setPreviewOps] = useState<CommitOp[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<PreviewError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!templateRow || !pkCol) return null;

  const pkList = pkListText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const valuesList = valuesText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const handlePreview = async () => {
    setError(null);
    if (pkList.length === 0) {
      setError("At least one new PK is required");
      return;
    }
    if (changeColumn && valuesList.length > 0 && valuesList.length !== pkList.length) {
      setError(`PK count (${pkList.length}) and values count (${valuesList.length}) must match`);
      return;
    }
    setLoading(true);
    try {
      setBaseState("Previewing");
      const result = await api.previewBatchGenerate({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        table: templateTable,
        template_pk: { [pkCol.name]: templateRow[pkCol.name] },
        new_pks: pkList,
        ...(changeColumn ? { change_column: changeColumn } : {}),
        ...(changeColumn && valuesList.length > 0 ? { change_values: valuesList } : {}),
      });
      setPreviewOps(result.ops);
      setWarnings(result.warnings || []);
      setErrors(result.errors || []);
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message || "Preview failed");
      setBaseState(useDraftStore.getState().ops.length > 0 ? "DraftEditing" : "Idle");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    for (const op of previewOps) {
      addOp(op);
    }
    setPreviewOps([]);
    setWarnings([]);
    setErrors([]);
    setBaseState("DraftEditing");
    toggleDrawer("changed");
    onClose();
  };

  const handleCancel = () => {
    if (previewOps.length > 0) {
      setPreviewOps([]);
      setWarnings([]);
      setErrors([]);
      setBaseState(useDraftStore.getState().ops.length > 0 ? "DraftEditing" : "Idle");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <h2>Batch Generate</h2>

        <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
          Template: <strong>{templateTable}</strong> / {pkCol.name} = {String(templateRow[pkCol.name])}
          {changeColumn && <> / Change: <strong>{changeColumn}</strong></>}
        </div>

        {error && (
          <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>
        )}

        {previewOps.length === 0 ? (
          <>
            <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
              {/* PK list */}
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  New PKs (one per line)
                </label>
                <textarea
                  value={pkListText}
                  onChange={(e) => setPkListText(e.target.value)}
                  rows={10}
                  style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
                  placeholder={"201\n202\n203"}
                />
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                  {pkList.length} items
                </div>
              </div>

              {/* Change values (only if changeColumn is set) */}
              {changeColumn && (
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    {changeColumn} values (one per line, optional)
                  </label>
                  <textarea
                    value={valuesText}
                    onChange={(e) => setValuesText(e.target.value)}
                    rows={10}
                    style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
                    placeholder={"active\ndraft\npending"}
                  />
                  <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                    {valuesList.length} items
                  </div>
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button onClick={onClose}>Cancel</button>
              <button
                className="primary"
                onClick={handlePreview}
                disabled={loading || pkList.length === 0}
              >
                {loading ? "Previewing..." : "Preview"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ marginBottom: 8 }}>
              {previewOps.length} rows will be inserted:
            </p>
            {warnings.length > 0 && (
              <div style={{ background: "#fff3cd", border: "1px solid #ffc107", padding: 8, borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
                <strong>Warnings:</strong>
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            {errors.length > 0 && (
              <div style={{ background: "#f8d7da", border: "1px solid #dc3545", padding: 8, borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
                <strong>Errors:</strong>
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  {errors.map((e, i) => <li key={i}>Row {e.row_index}: {e.message}</li>)}
                </ul>
              </div>
            )}
            <div style={{ maxHeight: 240, overflow: "auto", background: "#f5f5f8", padding: 8, borderRadius: 4, fontSize: 12 }}>
              <pre>{JSON.stringify(previewOps, null, 2)}</pre>
            </div>
            <div className="modal-actions">
              <button onClick={handleCancel}>Back</button>
              <button
                className="success"
                onClick={handleApply}
                disabled={errors.length > 0}
              >
                Apply to Draft ({previewOps.length} rows)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
