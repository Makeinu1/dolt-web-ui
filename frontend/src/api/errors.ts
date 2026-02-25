/**
 * Typed API error class for structured error handling.
 * Replaces raw `throw error` with a proper class that carries HTTP status, error code, and details.
 */
export class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: unknown;

    constructor(status: number, body: { code?: string; message?: string; details?: unknown }) {
        super(body.message ?? "Unknown API error");
        this.name = "ApiError";
        this.status = status;
        this.code = body.code ?? "INTERNAL";
        this.details = body.details;
    }
}
