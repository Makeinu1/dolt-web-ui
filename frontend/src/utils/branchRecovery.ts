import * as api from "../api/client";
import { ApiError } from "../api/errors";
import type { Branch } from "../types/api";

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
  retryAfterMs = 2000,
}: {
  targetId: string;
  dbName: string;
  branchName: string;
  refreshBranches: () => Promise<Branch[]>;
  retryAfterMs?: number;
}): Promise<boolean> {
  const attempts = Math.max(1, Math.ceil(retryAfterMs / 400));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const latestBranches = await refreshBranches();
      if (latestBranches.some((branch) => branch.name === branchName)) {
        await api.getHead(targetId, dbName, branchName);
        return true;
      }
    } catch {
      // Keep polling until the branch becomes queryable or the timeout expires.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
  return false;
}
