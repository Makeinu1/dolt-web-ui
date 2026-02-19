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

interface UIState {
  baseState: BaseState;
  requestPending: boolean; // orthogonal flag per v6f spec
  error: string | null;
  setBaseState: (state: BaseState) => void;
  setRequestPending: (pending: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  baseState: "Idle",
  requestPending: false,
  error: null,
  setBaseState: (baseState) => set({ baseState, error: null }),
  setRequestPending: (requestPending) => set({ requestPending }),
  setError: (error) => set({ error }),
  reset: () => set({ baseState: "Idle", requestPending: false, error: null }),
}));
