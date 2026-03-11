export interface BulkEditOperation {
  kind: "set-value" | "find-replace";
  value: string;
  searchValue?: string;
  emptyOnly: boolean;
}

export interface BulkEditPreview {
  oldStr: string;
  newStr: string;
  willChange: boolean;
  skipReason: string;
}

function normalizeCellValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function isBlankLike(value: string): boolean {
  return value === "" || value === "null" || value === "NULL";
}

export function previewBulkEdit(currentValue: unknown, operation: BulkEditOperation): BulkEditPreview {
  const oldStr = normalizeCellValue(currentValue);

  if (operation.kind === "find-replace") {
    if (!operation.searchValue) {
      return { oldStr, newStr: oldStr, willChange: false, skipReason: "検索文字列なし" };
    }
    if (!oldStr.includes(operation.searchValue)) {
      return { oldStr, newStr: oldStr, willChange: false, skipReason: "不一致" };
    }
    const newStr = oldStr.replaceAll(operation.searchValue, operation.value);
    if (newStr === oldStr) {
      return { oldStr, newStr, willChange: false, skipReason: "変更なし" };
    }
    return { oldStr, newStr, willChange: true, skipReason: "" };
  }

  if (operation.emptyOnly && !isBlankLike(oldStr)) {
    return { oldStr, newStr: oldStr, willChange: false, skipReason: "空欄以外" };
  }

  const newStr = operation.value;
  if (newStr === oldStr) {
    return { oldStr, newStr, willChange: false, skipReason: "変更なし" };
  }
  return { oldStr, newStr, willChange: true, skipReason: "" };
}
