import { describe, expect, it } from "vitest";
import { previewBulkEdit, type BulkEditOperation } from "./bulkEdit";

function apply(currentValue: unknown, operation: BulkEditOperation) {
  return previewBulkEdit(currentValue, operation);
}

describe("previewBulkEdit", () => {
  it("changes only blank-like values when emptyOnly is enabled", () => {
    const operation: BulkEditOperation = {
      kind: "set-value",
      value: "reviewer",
      emptyOnly: true,
    };

    expect(apply("", operation)).toMatchObject({ willChange: true, newStr: "reviewer" });
    expect(apply("null", operation)).toMatchObject({ willChange: true, newStr: "reviewer" });
    expect(apply("admin", operation)).toMatchObject({ willChange: false, skipReason: "空欄以外" });
  });

  it("skips no-op set-value updates", () => {
    const operation: BulkEditOperation = {
      kind: "set-value",
      value: "admin",
      emptyOnly: false,
    };

    expect(apply("admin", operation)).toMatchObject({ willChange: false, skipReason: "変更なし" });
  });

  it("replaces only matching rows for find-replace", () => {
    const operation: BulkEditOperation = {
      kind: "find-replace",
      value: "power-user",
      searchValue: "user",
      emptyOnly: false,
    };

    expect(apply("user", operation)).toMatchObject({ willChange: true, newStr: "power-user" });
    expect(apply("admin", operation)).toMatchObject({ willChange: false, skipReason: "不一致" });
  });

  it("skips no-op find-replace updates", () => {
    const operation: BulkEditOperation = {
      kind: "find-replace",
      value: "user",
      searchValue: "user",
      emptyOnly: false,
    };

    expect(apply("user", operation)).toMatchObject({ willChange: false, skipReason: "変更なし" });
  });
});
