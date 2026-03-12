import { create } from "zustand";
import { safeGetJSON, safeSetJSON } from "../utils/safeStorage";

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

const CONTEXT_STORAGE_KEY = "dolt-web-ui-context";

interface PersistedContextState {
  targetId: string;
  dbName: string;
  branchName: string;
}

function loadInitialContext(): PersistedContextState {
  if (typeof window === "undefined") {
    return { targetId: "", dbName: "", branchName: "" };
  }
  return safeGetJSON<PersistedContextState>(sessionStorage, CONTEXT_STORAGE_KEY, {
    targetId: "",
    dbName: "",
    branchName: "",
  });
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
const initialContext = loadInitialContext();

export const useContextStore = create<ContextState>((set) => ({
  targetId: initialContext.targetId,
  dbName: initialContext.dbName,
  branchName: initialContext.branchName,
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

useContextStore.subscribe((state) => {
  if (typeof window === "undefined") return;
  safeSetJSON(sessionStorage, CONTEXT_STORAGE_KEY, {
    targetId: state.targetId,
    dbName: state.dbName,
    branchName: state.branchName,
  });
});
