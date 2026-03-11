import * as api from "../api/client";
import { ApiError } from "../api/errors";
import type { Branch } from "../types/api";
import {
  UI_BRANCH_READY_DEFAULT_WAIT_MS,
  UI_BRANCH_READY_POLL_MS,
} from "../constants/ui";

export interface BranchErrorDetails {
  branchName?: string;
  retryAfterMs?: number;
}

export function getBranchErrorDetails(err: ApiError): BranchErrorDetails {
  if (!err.details || typeof err.details !== "object") {
    return {};
  }
  const details = err.details as Record<string, unknown>;
  return {
    branchName: typeof details.branch_name === "string" ? details.branch_name : undefined,
    retryAfterMs: typeof details.retry_after_ms === "number" ? details.retry_after_ms : undefined,
  };
}

export async function waitForBranchReady({
  targetId,
  dbName,
  branchName,
  refreshBranches,
  retryAfterMs = UI_BRANCH_READY_DEFAULT_WAIT_MS,
}: {
  targetId: string;
  dbName: string;
  branchName: string;
  refreshBranches: () => Promise<Branch[]>;
  retryAfterMs?: number;
}): Promise<boolean> {
  const attempts = Math.max(1, Math.ceil(retryAfterMs / UI_BRANCH_READY_POLL_MS));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const readiness = await api.getBranchReady(targetId, dbName, branchName);
      if (readiness.ready) {
        await refreshBranches();
        return true;
      }
    } catch (err) {
      if (!(err instanceof ApiError) || (err.code !== "BRANCH_NOT_READY" && err.code !== "NOT_FOUND")) {
        // Ignore transient API errors while polling and keep retrying until the timeout expires.
      }
    }

    try {
      await refreshBranches();
    } catch {
      // Keep polling until the branch becomes queryable or the timeout expires.
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, UI_BRANCH_READY_POLL_MS));
    }
  }
  return false;
}
