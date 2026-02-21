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
  requestCount: number; // number of pending approval requests (0 = none)
  error: string | null;
  setBaseState: (state: BaseState) => void;
  setRequestCount: (count: number) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  baseState: "Idle",
  requestCount: 0,
  error: null,
  setBaseState: (baseState) => set({ baseState, error: null }),
  setRequestCount: (requestCount) => set({ requestCount }),
  setError: (error) => set({ error }),
  reset: () => set({ baseState: "Idle", requestCount: 0, error: null }),
}));
