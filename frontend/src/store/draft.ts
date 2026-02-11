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
    const ops = [...get().ops, op];
    saveDraft(ops);
    set({ ops });
  },
  removeOp: (index) => {
    const ops = get().ops.filter((_, i) => i !== index);
    saveDraft(ops);
    set({ ops });
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
