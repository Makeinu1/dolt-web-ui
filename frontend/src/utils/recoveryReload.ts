import type { CommitOp } from "../types/api";
import { DRAFT_STORAGE_KEY } from "../store/draft";
import { safeGetJSON } from "./safeStorage";

export const RECOVERY_RELOAD_FLAG = "dolt-web-ui-recovery-reload";
export const RECOVERY_WIPE_PREFS_FLAG = "dolt-web-ui-recovery-wipe-prefs";
const COL_VISIBILITY_PREFIX = "colVisibility/";
const RECOVERY_CONFIRM_MESSAGE = "未保存の変更を破棄して復旧します。よろしいですか？";

interface RecoveryReloadOptions {
  wipePrefs?: boolean;
  hasUnsavedDraft?: boolean;
  reload?: () => void;
}

export function hasPersistedDraft(): boolean {
  if (typeof window === "undefined") return false;
  return safeGetJSON<CommitOp[]>(sessionStorage, DRAFT_STORAGE_KEY, []).length > 0;
}

function clearLocalPreferences() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith(COL_VISIBILITY_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

export function applyPendingRecoveryReset(): boolean {
  if (typeof window === "undefined") return false;
  if (sessionStorage.getItem(RECOVERY_RELOAD_FLAG) !== "1") return false;

  sessionStorage.removeItem(RECOVERY_RELOAD_FLAG);
  const wipePrefs = sessionStorage.getItem(RECOVERY_WIPE_PREFS_FLAG) === "1";
  sessionStorage.removeItem(RECOVERY_WIPE_PREFS_FLAG);
  sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  if (wipePrefs) {
    clearLocalPreferences();
  }
  return true;
}

export function performRecoveryReload({
  wipePrefs = false,
  hasUnsavedDraft,
  reload,
}: RecoveryReloadOptions = {}): boolean {
  if (typeof window === "undefined") return false;

  const shouldConfirm = hasUnsavedDraft ?? hasPersistedDraft();
  if (shouldConfirm && !window.confirm(RECOVERY_CONFIRM_MESSAGE)) {
    return false;
  }

  sessionStorage.setItem(RECOVERY_RELOAD_FLAG, "1");
  if (wipePrefs) {
    sessionStorage.setItem(RECOVERY_WIPE_PREFS_FLAG, "1");
  } else {
    sessionStorage.removeItem(RECOVERY_WIPE_PREFS_FLAG);
  }

  const reloadPage = reload ?? (() => window.location.reload());
  reloadPage();
  return true;
}
