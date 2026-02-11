import { create } from "zustand";

interface ContextState {
  targetId: string;
  dbName: string;
  branchName: string;
  setTarget: (targetId: string) => void;
  setDatabase: (dbName: string) => void;
  setBranch: (branchName: string) => void;
  reset: () => void;
}

export const useContextStore = create<ContextState>((set) => ({
  targetId: "",
  dbName: "",
  branchName: "",
  setTarget: (targetId) => set({ targetId, dbName: "", branchName: "" }),
  setDatabase: (dbName) => set({ dbName, branchName: "" }),
  setBranch: (branchName) => set({ branchName }),
  reset: () => set({ targetId: "", dbName: "", branchName: "" }),
}));
