import { describe, expect, it } from "vitest";

import { isCompleted, operationMessage, readIntegrityMessage } from "./apiResult";

describe("apiResult helpers", () => {
  it("treats completed as the only success outcome", () => {
    expect(isCompleted({ outcome: "completed" })).toBe(true);
    expect(isCompleted({ outcome: "failed" })).toBe(false);
    expect(isCompleted({ outcome: "retry_required" })).toBe(false);
  });

  it("prefers backend operation message over fallback", () => {
    expect(operationMessage({ message: "backend message" }, "fallback")).toBe("backend message");
    expect(operationMessage({ message: "" }, "fallback")).toBe("fallback");
  });

  it("requires complete read integrity before rendering results", () => {
    expect(readIntegrityMessage({ read_integrity: "complete", message: "ok" }, "fallback")).toBeNull();
    expect(readIntegrityMessage({ read_integrity: "failed", message: "broken" }, "fallback")).toBe("broken");
    expect(readIntegrityMessage({ read_integrity: "degraded", message: "" }, "fallback")).toBe("fallback");
  });
});
