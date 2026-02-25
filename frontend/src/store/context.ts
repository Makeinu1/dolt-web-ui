import { create } from "zustand";

interface ContextState {
  targetId: string;
  dbName: string;
  branchName: string;
  branchRefreshKey: number;
  setTarget: (targetId: string) => void;
  setDatabase: (dbName: string) => void;
  setBranch: (branchName: string) => void;
  triggerBranchRefresh: () => void;
  reset: () => void;
}

/**
 * C-3: Decoupled ContextStore
 *
 * Previously, setTarget / setDatabase / setBranch called other stores
 * (useDraftStore, useUIStore) directly inside the Zustand action, creating
 * tight coupling between stores.
 *
 * Now the store only manages its own slice of state. Side effects
 * (clearing drafts, resetting UI state) are handled by App.tsx useEffects
 * that react to context changes — keeping stores independent.
 */
export const useContextStore = create<ContextState>((set) => ({
  targetId: "",
  dbName: "",
  branchName: "",
  branchRefreshKey: 0,
  setTarget: (targetId) => {
    set({ targetId, dbName: "", branchName: "" });
  },
  setDatabase: (dbName) => {
    set({ dbName, branchName: "" });
  },
  setBranch: (branchName) => {
    set({ branchName });
  },
  triggerBranchRefresh: () => set((s) => ({ branchRefreshKey: s.branchRefreshKey + 1 })),
  reset: () => set({ targetId: "", dbName: "", branchName: "", branchRefreshKey: 0 }),
}));
