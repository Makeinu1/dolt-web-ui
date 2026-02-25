import { create } from "zustand";
import type { CommitOp } from "../types/api";

const STORAGE_KEY = "dolt-web-ui-draft";

interface DraftState {
  ops: CommitOp[];
  addOp: (op: CommitOp) => void;
  removeOp: (index: number) => void;
  clearDraft: () => void;
  loadDraft: () => void;
  hasDraft: () => boolean;
}

function saveDraft(ops: CommitOp[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ops));
}

export const useDraftStore = create<DraftState>((set, get) => ({
  ops: [],
  addOp: (op) => {
    const currentOps = get().ops;

    // Auto-cancel logic for row updates
    // If we're updating a row that was already updated, and the new value
    // makes the total operation a no-op (e.g. A -> B -> A), we should remove it.
    if (op.type === "update") {
      const existingIdx = currentOps.findIndex(
        (o) => o.type === "update" && o.table === op.table && JSON.stringify(o.pk) === JSON.stringify(op.pk)
      );

      if (existingIdx !== -1) {
        const existingOp = currentOps[existingIdx];
        // For simplicity, if we are overwriting the ONLY changed column and it reverts to some known state
        // Actually, without knowing the *original* DB state, it's hard to know if A->B->A reverts to DB.
        // But we can at least merge updates for the same row.
        const mergedValues = { ...existingOp.values, ...op.values };

        // If they just removed their change (e.g. cleared the cell and we don't have original data here)
        // Wait, the UI (TableGrid) currently always sends the *new* value. 
        // Real auto-cancelling requires knowing the original data from `rowData`.
        // For now: we merge multiple updates to the same row into a single op to prevent clutter.
        const modifiedOp = { ...existingOp, values: mergedValues };

        const nextOps = [...currentOps];
        nextOps[existingIdx] = modifiedOp;
        saveDraft(nextOps);
        set({ ops: nextOps });
        return;
      }
    }

    const nextOps = [...currentOps, op];
    saveDraft(nextOps);
    set({ ops: nextOps });
  },
  removeOp: (index) => {
    const nextOps = get().ops.filter((_, i) => i !== index);
    saveDraft(nextOps);
    set({ ops: nextOps });
  },
  clearDraft: () => {
    sessionStorage.removeItem(STORAGE_KEY);
    set({ ops: [] });
  },
  loadDraft: () => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        set({ ops: JSON.parse(raw) });
      } catch {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    }
  },
  hasDraft: () => get().ops.length > 0,
}));
