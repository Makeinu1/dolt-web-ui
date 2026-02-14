import { create } from "zustand";
import { useDraftStore } from "./draft";
import { useUIStore } from "./ui";

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

export const useContextStore = create<ContextState>((set, get) => ({
  targetId: "",
  dbName: "",
  branchName: "",
  branchRefreshKey: 0,
  setTarget: (targetId) => {
    set({ targetId, dbName: "", branchName: "" });
    useDraftStore.getState().clearDraft();
    useUIStore.getState().setBaseState("Idle");
  },
  setDatabase: (dbName) => {
    set({ dbName, branchName: "" });
    useDraftStore.getState().clearDraft();
    useUIStore.getState().setBaseState("Idle");
  },
  setBranch: (branchName) => {
    const prev = get().branchName;
    set({ branchName });
    if (prev && prev !== branchName) {
      useDraftStore.getState().clearDraft();
      useUIStore.getState().setBaseState("Idle");
    }
  },
  triggerBranchRefresh: () => set((s) => ({ branchRefreshKey: s.branchRefreshKey + 1 })),
  reset: () => set({ targetId: "", dbName: "", branchName: "", branchRefreshKey: 0 }),
}));
