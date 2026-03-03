import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api/client";
import { ApiError } from "../api/errors";

interface UseHeadSyncOptions {
    targetId: string;
    dbName: string;
    branchName: string;
    branchRefreshKey: number;
    isContextReady: boolean;
    onError: (msg: string) => void;
    hasError?: () => boolean;
}

interface UseHeadSyncReturn {
    expectedHead: string;
    setExpectedHead: (hash: string) => void;
    refreshHead: () => void;
}

/**
 * C-1: useHeadSync
 *
 * Manages the `expectedHead` (SHA hash of the current HEAD commit) for the
 * active branch. Handles:
 * - Automatic reload when context changes
 * - Race-condition guard (stale response from a previous branch is ignored)
 * - Reload triggered by `branchRefreshKey` (approve / reject / revert)
 */
export function useHeadSync({
    targetId,
    dbName,
    branchName,
    branchRefreshKey,
    isContextReady,
    onError,
    hasError,
}: UseHeadSyncOptions): UseHeadSyncReturn {
    const [expectedHead, setExpectedHead] = useState("");

    // Ref to guard against stale async responses when branch changes quickly
    const branchRef = useRef(branchName);
    useEffect(() => {
        branchRef.current = branchName;
    }, [branchName]);

    const refreshHead = useCallback(() => {
        if (!isContextReady) return;
        const requestBranch = branchName;
        api
            .getHead(targetId, dbName, branchName)
            .then((h) => {
                if (branchRef.current === requestBranch) {
                    setExpectedHead(h.hash);
                }
            })
            .catch((err: unknown) => {
                if (branchRef.current !== requestBranch) return;
                // Don't overwrite an existing error with a background HEAD fetch error.
                // This prevents the "error reappears after dismiss" loop.
                if (hasError && hasError()) return;
                const message =
                    err instanceof ApiError
                        ? err.message
                        : (err as { message?: string })?.message;
                onError(message ?? "HEADの取得に失敗しました");
            });
    }, [targetId, dbName, branchName, isContextReady, onError]);

    // Initial load and reload when context changes
    useEffect(() => {
        refreshHead();
    }, [refreshHead]);

    // Reload when branchRefreshKey increments (triggered by approve/reject/revert)
    useEffect(() => {
        if (branchRefreshKey > 0) {
            refreshHead();
        }
    }, [branchRefreshKey, refreshHead]);

    return { expectedHead, setExpectedHead, refreshHead };
}
