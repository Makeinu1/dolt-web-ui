import { beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_STORAGE_KEY } from "../store/draft";
import {
  RECOVERY_RELOAD_FLAG,
  RECOVERY_WIPE_PREFS_FLAG,
  applyPendingRecoveryReset,
  hasPersistedDraft,
  performRecoveryReload,
} from "./recoveryReload";

describe("recoveryReload", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps normal reload behavior untouched when no recovery flag exists", () => {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify([{ type: "insert", table: "users", values: { id: 1 } }]));

    expect(applyPendingRecoveryReset()).toBe(false);
    expect(hasPersistedDraft()).toBe(true);
  });

  it("marks a recovery reload and triggers browser reload", () => {
    const reloadSpy = vi.fn();

    const started = performRecoveryReload({ hasUnsavedDraft: false, reload: reloadSpy });

    expect(started).toBe(true);
    expect(sessionStorage.getItem(RECOVERY_RELOAD_FLAG)).toBe("1");
    expect(sessionStorage.getItem(RECOVERY_WIPE_PREFS_FLAG)).toBeNull();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("asks for confirmation when draft exists and aborts on cancel", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const reloadSpy = vi.fn();

    const started = performRecoveryReload({ hasUnsavedDraft: true, reload: reloadSpy });

    expect(started).toBe(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RECOVERY_RELOAD_FLAG)).toBeNull();
  });

  it("clears persisted draft during one-shot recovery reset", () => {
    sessionStorage.setItem(RECOVERY_RELOAD_FLAG, "1");
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify([{ type: "insert", table: "users", values: { id: 1 } }]));

    const applied = applyPendingRecoveryReset();

    expect(applied).toBe(true);
    expect(sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(RECOVERY_RELOAD_FLAG)).toBeNull();
  });

  it("optionally clears column visibility preferences", () => {
    sessionStorage.setItem(RECOVERY_RELOAD_FLAG, "1");
    sessionStorage.setItem(RECOVERY_WIPE_PREFS_FLAG, "1");
    localStorage.setItem("colVisibility/local/test_db/users", JSON.stringify(["name"]));
    localStorage.setItem("unrelated", "keep");

    applyPendingRecoveryReset();

    expect(localStorage.getItem("colVisibility/local/test_db/users")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
});
