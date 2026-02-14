import { create } from "zustand";

// v6f UI state machine states
export type BaseState =
  | "Idle"
  | "DraftEditing"
  | "Previewing"
  | "Committing"
  | "Syncing"
  | "MergeConflictsPresent"
  | "SchemaConflictDetected"
  | "ConstraintViolationDetected"
  | "StaleHeadDetected";

export type DrawerType = "changed" | "diff" | null;

interface UIState {
  baseState: BaseState;
  requestPending: boolean; // orthogonal flag per v6f spec
  error: string | null;
  drawerOpen: DrawerType;
  setBaseState: (state: BaseState) => void;
  setRequestPending: (pending: boolean) => void;
  setError: (error: string | null) => void;
  toggleDrawer: (type: "changed" | "diff") => void;
  closeDrawer: () => void;
  reset: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  baseState: "Idle",
  requestPending: false,
  error: null,
  drawerOpen: null,
  setBaseState: (baseState) => set({ baseState, error: null }),
  setRequestPending: (requestPending) => set({ requestPending }),
  setError: (error) => set({ error }),
  toggleDrawer: (type) => set({ drawerOpen: get().drawerOpen === type ? null : type }),
  closeDrawer: () => set({ drawerOpen: null }),
  reset: () => set({ baseState: "Idle", requestPending: false, error: null, drawerOpen: null }),
}));
