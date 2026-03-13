import { create } from "zustand";
import type { CommitOp } from "../types/api";
import { safeGetJSON, safeSetJSON } from "../utils/safeStorage";
import { stablePkJson } from "../utils/stablePk";
import { UI_DRAFT_SAVE_DEBOUNCE_MS } from "../constants/ui";
import { createClientRowId } from "../utils/clientRowId";

export const DRAFT_STORAGE_KEY = "dolt-web-ui-draft";

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
    safeSetJSON(sessionStorage, DRAFT_STORAGE_KEY, _pendingOps);
    _saveTimer = null;
    _pendingOps = null;
  }, UI_DRAFT_SAVE_DEBOUNCE_MS);
}

function saveDraftImmediate(ops: CommitOp[]) {
  if (_saveTimer !== null) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    _pendingOps = null;
  }
  safeSetJSON(sessionStorage, DRAFT_STORAGE_KEY, ops);
}

function pkMatchesInsert(opPk: Record<string, unknown>, insertOp: CommitOp): boolean {
  return stablePkJson(
    Object.fromEntries(Object.keys(opPk).map((key) => [key, insertOp.values[key]]))
  ) === stablePkJson(opPk);
}

function normalizeLoadedOps(ops: CommitOp[]): CommitOp[] {
  return ops.map((op) => {
    if (op.type !== "insert" || op.client_row_id || op.table.startsWith("_memo_")) {
      return op;
    }
    return { ...op, client_row_id: createClientRowId() };
  });
}

// Flush any pending debounced write before the page unloads to prevent data loss.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (_saveTimer !== null && _pendingOps !== null) {
      clearTimeout(_saveTimer);
      safeSetJSON(sessionStorage, DRAFT_STORAGE_KEY, _pendingOps);
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
      const insertIdx = currentOps.findIndex(
        (o) =>
          o.type === "insert" &&
          o.table === op.table &&
          (
            op.client_row_id
              ? o.client_row_id === op.client_row_id
              : o.client_row_id == null && pkMatchesInsert(opPk, o)
          )
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
      const existingIdx = currentOps.findIndex(
        (o) =>
          o.type === "update" &&
          o.table === op.table &&
          (
            op.client_row_id
              ? o.client_row_id === op.client_row_id
              : o.client_row_id == null &&
                o.pk != null &&
                op.pk != null &&
                stablePkJson(o.pk) === stablePkJson(op.pk)
          )
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
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    set({ ops: [] });
  },
  loadDraft: () => {
    const storedOps = safeGetJSON<CommitOp[]>(sessionStorage, DRAFT_STORAGE_KEY, []);
    const ops = normalizeLoadedOps(storedOps);
    if (ops.length > 0) {
      if (JSON.stringify(ops) !== JSON.stringify(storedOps)) {
        saveDraftImmediate(ops);
      }
      set({ ops });
    }
  },
  hasDraft: () => get().ops.length > 0,
}));
