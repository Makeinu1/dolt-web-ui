import { useRef, useState } from "react";
import { useContextStore } from "../../store/context";
import { useTemplateStore } from "../../store/template";
import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";
import { BatchGenerateModal } from "../BatchGenerateModal/BatchGenerateModal";
import * as api from "../../api/client";
import type { CommitOp, PreviewError } from "../../types/api";

export function TemplatePanel() {
  const { targetId, dbName, branchName } = useContextStore();
  const {
    templateRow,
    templateTable,
    templateColumns,
    changeColumn,
    setChangeColumn,
    clearTemplate,
  } = useTemplateStore();
  const addOp = useDraftStore((s) => s.addOp);
  const setBaseState = useUIStore((s) => s.setBaseState);

  const pkCol = templateColumns.find((c) => c.primary_key);
  const nonPkCols = templateColumns.filter((c) => !c.primary_key);

  // Quick Clone state
  const [newPK, setNewPK] = useState("");
  const [quickChangeValue, setQuickChangeValue] = useState("");
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [cloneCount, setCloneCount] = useState(0);
  const pkInputRef = useRef<HTMLInputElement>(null);

  // Batch Generate modal state
  const [showBatchGenerate, setShowBatchGenerate] = useState(false);

  // Bulk Update (TSV) modal state
  const [showBulk, setShowBulk] = useState(false);
  const [tsvData, setTsvData] = useState("");
  const [bulkPreviewOps, setBulkPreviewOps] = useState<CommitOp[]>([]);
  const [bulkWarnings, setBulkWarnings] = useState<string[]>([]);
  const [bulkErrors, setBulkErrors] = useState<PreviewError[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);

  if (!templateRow || !pkCol) {
    return (
      <div style={{ padding: 24, color: "#888", textAlign: "center", fontSize: 13 }}>
        Click the &quot;Template&quot; button on a grid row to set it as a template.
      </div>
    );
  }

  // --- Quick Clone ---
  const handleQuickClone = async () => {
    const pk = newPK.trim();
    if (!pk) return;
    setQuickLoading(true);
    setQuickError(null);
    try {
      const result = await api.previewClone({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        table: templateTable,
        template_pk: { [pkCol.name]: templateRow[pkCol.name] },
        new_pks: [pk],
        ...(changeColumn ? { change_column: changeColumn } : {}),
        ...(changeColumn && quickChangeValue ? { change_value: quickChangeValue } : {}),
      });
      if (result.errors?.length > 0) {
        setQuickError(result.errors[0].message);
      } else {
        for (const op of result.ops) {
          addOp(op);
        }
        setBaseState("DraftEditing");
        setCloneCount((c) => c + 1);
        setNewPK("");
        // Keep change value for rapid-fire; refocus PK input
        requestAnimationFrame(() => pkInputRef.current?.focus());
      }
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setQuickError(e?.error?.message || "Clone failed");
    } finally {
      setQuickLoading(false);
    }
  };

  // --- Bulk Update (TSV) ---
  const handleBulkPreview = async () => {
    setBulkError(null);
    if (!tsvData.trim()) {
      setBulkError("TSV data is required");
      return;
    }
    try {
      setBaseState("Previewing");
      const result = await api.previewBulkUpdate({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        table: templateTable,
        tsv_data: tsvData,
      });
      setBulkPreviewOps(result.ops);
      setBulkWarnings(result.warnings || []);
      setBulkErrors(result.errors || []);
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setBulkError(e?.error?.message || "Preview failed");
      setBaseState(useDraftStore.getState().ops.length > 0 ? "DraftEditing" : "Idle");
    }
  };

  const applyBulkPreview = () => {
    for (const op of bulkPreviewOps) {
      addOp(op);
    }
    setBulkPreviewOps([]);
    setBulkWarnings([]);
    setBulkErrors([]);
    setShowBulk(false);
    setTsvData("");
    setBaseState("DraftEditing");
  };

  const cancelBulkPreview = () => {
    setBulkPreviewOps([]);
    setBulkWarnings([]);
    setBulkErrors([]);
    setBaseState(useDraftStore.getState().ops.length > 0 ? "DraftEditing" : "Idle");
  };

  const handleClearTemplate = () => {
    clearTemplate();
    setNewPK("");
    setQuickChangeValue("");
    setCloneCount(0);
  };

  return (
    <div style={{ padding: 16, fontSize: 13 }}>
      {/* Template Row Summary */}
      <div
        style={{
          background: "#e0e7ff",
          border: "1px solid #a5b4fc",
          borderRadius: 6,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12, color: "#4338ca" }}>
          Template: {templateTable}
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 12 }}>
          <span style={{ fontWeight: 700 }}>{pkCol.name}</span>: {String(templateRow[pkCol.name])}
        </div>
        {nonPkCols.slice(0, 4).map((col) => (
          <div key={col.name} style={{ fontFamily: "monospace", fontSize: 11, color: "#555" }}>
            {col.name}: {String(templateRow[col.name] ?? "")}
          </div>
        ))}
        {nonPkCols.length > 4 && (
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
            +{nonPkCols.length - 4} more columns
          </div>
        )}
      </div>

      {/* Change Column Dropdown */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Change Column (optional)
        </label>
        <select
          value={changeColumn}
          onChange={(e) => setChangeColumn(e.target.value)}
          style={{ width: "100%", padding: "4px 8px", fontSize: 13 }}
        >
          <option value="">-- None --</option>
          {nonPkCols.map((col) => (
            <option key={col.name} value={col.name}>
              {col.name} ({col.type})
            </option>
          ))}
        </select>
      </div>

      {/* Quick Clone */}
      <div
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12 }}>Quick Clone</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleQuickClone();
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 2 }}>
              New PK ({pkCol.name})
            </label>
            <input
              ref={pkInputRef}
              value={newPK}
              onChange={(e) => setNewPK(e.target.value)}
              placeholder={`e.g. 201`}
              style={{ width: "100%", padding: "4px 8px", fontSize: 13 }}
              disabled={quickLoading}
              autoFocus
            />
          </div>
          {changeColumn && (
            <div style={{ marginBottom: 6 }}>
              <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 2 }}>
                {changeColumn} value
              </label>
              <input
                value={quickChangeValue}
                onChange={(e) => setQuickChangeValue(e.target.value)}
                placeholder={`Value for ${changeColumn}`}
                style={{ width: "100%", padding: "4px 8px", fontSize: 13 }}
                disabled={quickLoading}
              />
            </div>
          )}
          <button
            type="submit"
            className="primary"
            disabled={quickLoading || !newPK.trim()}
            style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "6px 0" }}
          >
            {quickLoading ? "Cloning..." : "+ Clone"}
          </button>
        </form>
        {quickError && (
          <div style={{ color: "#991b1b", fontSize: 12, marginTop: 6 }}>{quickError}</div>
        )}
        {cloneCount > 0 && (
          <div style={{ color: "#065f46", fontSize: 12, marginTop: 6 }}>
            {cloneCount} row(s) cloned in this session
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          onClick={() => setShowBatchGenerate(true)}
          style={{ fontSize: 13, padding: "6px 12px" }}
        >
          Batch Generate...
        </button>
        <button
          onClick={() => setShowBulk(true)}
          style={{ fontSize: 13, padding: "6px 12px" }}
        >
          Bulk Update (TSV)...
        </button>
        <button
          onClick={handleClearTemplate}
          style={{ fontSize: 13, padding: "6px 12px", color: "#991b1b" }}
        >
          Clear Template
        </button>
      </div>

      {/* Bulk Update (TSV) Modal */}
      {showBulk && (
        <div className="modal-overlay" onClick={() => { setShowBulk(false); cancelBulkPreview(); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Bulk Update (TSV)</h2>
            {bulkError && <div className="error-banner">{bulkError}</div>}
            {bulkPreviewOps.length === 0 ? (
              <>
                <p style={{ fontSize: 12, marginBottom: 8, color: "#666" }}>
                  Paste TSV data. First column = PK, first row = header.
                </p>
                <textarea
                  value={tsvData}
                  onChange={(e) => setTsvData(e.target.value)}
                  rows={10}
                  style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
                  placeholder={`${pkCol.name}\tcolumn1\tcolumn2\n100\tvalue1\tvalue2`}
                />
                <div className="modal-actions">
                  <button onClick={() => setShowBulk(false)}>Cancel</button>
                  <button className="primary" onClick={handleBulkPreview}>Preview</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ marginBottom: 8 }}>{bulkPreviewOps.length} rows will be updated:</p>
                {bulkWarnings.length > 0 && (
                  <div style={{ background: "#fff3cd", border: "1px solid #ffc107", padding: 8, borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
                    <strong>Warnings:</strong>
                    <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                      {bulkWarnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
                {bulkErrors.length > 0 && (
                  <div style={{ background: "#f8d7da", border: "1px solid #dc3545", padding: 8, borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
                    <strong>Errors:</strong>
                    <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                      {bulkErrors.map((e, i) => <li key={i}>Row {e.row_index}: {e.message}</li>)}
                    </ul>
                  </div>
                )}
                <div style={{ maxHeight: 200, overflow: "auto", background: "#f5f5f8", padding: 8, borderRadius: 4, fontSize: 12 }}>
                  <pre>{JSON.stringify(bulkPreviewOps, null, 2)}</pre>
                </div>
                <div className="modal-actions">
                  <button onClick={cancelBulkPreview}>Cancel</button>
                  <button className="success" onClick={applyBulkPreview} disabled={bulkErrors.length > 0}>
                    Apply to Draft
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Batch Generate Modal */}
      {showBatchGenerate && (
        <BatchGenerateModal onClose={() => setShowBatchGenerate(false)} />
      )}
    </div>
  );
}
