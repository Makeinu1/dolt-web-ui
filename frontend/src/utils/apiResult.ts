import type { OperationResultFields, ReadResultFields } from "../types/api";

export function isCompleted(result: Pick<OperationResultFields, "outcome">): boolean {
  return result.outcome === "completed";
}

export function operationMessage(
  result: Pick<OperationResultFields, "message">,
  fallback: string
): string {
  return result.message || fallback;
}

export function readIntegrityMessage(
  result: Pick<ReadResultFields, "read_integrity" | "message">,
  fallback: string
): string | null {
  if (result.read_integrity === "complete") {
    return null;
  }
  return result.message || fallback;
}
