import { create } from "zustand";
import type { CommitOp } from "../types/api";
import { safeGetJSON, safeSetJSON } from "../utils/safeStorage";
import { stablePkJson } from "../utils/stablePk";

const STORAGE_KEY = "dolt-web-ui-draft";

interface DraftState {
  ops: CommitOp[];
  addOp: (op: CommitOp) => void;
  removeOp: (index: number) => void;
  clearDraft: () => void;
  loadDraft: () => void;
  hasDraft: () => boolean;
}

// Debounced sessionStorage writes to avoid excessive serialization on rapid cell edits.
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingOps: CommitOp[] | null = null;

function saveDraftDebounced(ops: CommitOp[]) {
  _pendingOps = ops;
  if (_saveTimer !== null) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    safeSetJSON(sessionStorage, STORAGE_KEY, _pendingOps);
    _saveTimer = null;
    _pendingOps = null;
  }, 500);
}

function saveDraftImmediate(ops: CommitOp[]) {
  if (_saveTimer !== null) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    _pendingOps = null;
  }
  safeSetJSON(sessionStorage, STORAGE_KEY, ops);
}

// Flush any pending debounced write before the page unloads to prevent data loss.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (_saveTimer !== null && _pendingOps !== null) {
      clearTimeout(_saveTimer);
      safeSetJSON(sessionStorage, STORAGE_KEY, _pendingOps);
    }
  });
}

export const useDraftStore = create<DraftState>((set, get) => ({
  ops: [],
  addOp: (op) => {
    const currentOps = get().ops;

    // Absorb UPDATE/DELETE into a pending INSERT for the same row.
    // When a copied row (INSERT op) is subsequently edited or deleted,
    // the new op must be folded into the INSERT rather than sent separately —
    // otherwise the backend would try to INSERT a duplicate PK first and fail.
    if ((op.type === "update" || op.type === "delete") && op.pk) {
      const opPk = op.pk;
      const opPkKey = stablePkJson(opPk);
      const insertIdx = currentOps.findIndex(
        (o) =>
          o.type === "insert" &&
          o.table === op.table &&
          stablePkJson(
            Object.fromEntries(Object.keys(opPk).map((k) => [k, o.values[k]]))
          ) === opPkKey
      );
      if (insertIdx !== -1) {
        if (op.type === "delete") {
          // Copying then deleting = no-op: cancel the INSERT entirely.
          const nextOps = currentOps.filter((_, i) => i !== insertIdx);
          saveDraftImmediate(nextOps);
          set({ ops: nextOps });
        } else {
          // Merge the UPDATE's values into the INSERT's values.
          const insertOp = currentOps[insertIdx];
          const mergedValues = { ...insertOp.values, ...op.values };
          const nextOps = [...currentOps];
          nextOps[insertIdx] = { ...insertOp, values: mergedValues };
          saveDraftDebounced(nextOps);
          set({ ops: nextOps });
        }
        return;
      }
    }

    // Merge consecutive UPDATEs to the same row into a single op.
    if (op.type === "update") {
      const opPkKey = op.pk ? stablePkJson(op.pk) : "";
      const existingIdx = currentOps.findIndex(
        (o) =>
          o.type === "update" &&
          o.table === op.table &&
          o.pk != null &&
          stablePkJson(o.pk) === opPkKey
      );

      if (existingIdx !== -1) {
        const existingOp = currentOps[existingIdx];
        const mergedValues = { ...existingOp.values, ...op.values };
        const modifiedOp = { ...existingOp, values: mergedValues };
        const nextOps = [...currentOps];
        nextOps[existingIdx] = modifiedOp;
        saveDraftDebounced(nextOps);
        set({ ops: nextOps });
        return;
      }
    }

    const nextOps = [...currentOps, op];
    saveDraftDebounced(nextOps);
    set({ ops: nextOps });
  },
  removeOp: (index) => {
    const nextOps = get().ops.filter((_, i) => i !== index);
    saveDraftImmediate(nextOps);
    set({ ops: nextOps });
  },
  clearDraft: () => {
    if (_saveTimer !== null) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
      _pendingOps = null;
    }
    sessionStorage.removeItem(STORAGE_KEY);
    set({ ops: [] });
  },
  loadDraft: () => {
    const ops = safeGetJSON<CommitOp[]>(sessionStorage, STORAGE_KEY, []);
    if (ops.length > 0) set({ ops });
  },
  hasDraft: () => get().ops.length > 0,
}));
