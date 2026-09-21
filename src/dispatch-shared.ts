import { APIGatewayProxyResult } from "aws-lambda";
import { ErrorObject } from "./handler-types";

/**
 * How a request ended. Distinguishes the four failure modes so a metrics query
 * can tell "clients are sending bad auth" apart from "the handler is broken".
 */
export type RequestOutcome = "success" | "not_found" | "unauthorized" | "handler_error" | "unhandled_error";

export interface RequestMetrics {
    method: string;
    /**
     * The *registered route*, never the concrete request path — `/orders/{orderId}/receipt`
     * rather than `/orders/abc123/receipt`. Under proxy routing the concrete path carries
     * one series per id, which would make aggregation by resource useless.
     */
    resource: string;
    statusCode: number;
    outcome: RequestOutcome;
    /** Absent only when no route matched. Recorded even when authorization throws. */
    authorizeMs?: number;
    /** Absent when no route matched or authorization failed. Recorded even when the handler throws. */
    handlerMs?: number;
    totalMs: number;
    requestId: string;
}

export function errorResponse(error: ErrorObject): APIGatewayProxyResult {
    return { statusCode: error.statusCode, body: JSON.stringify({ message: error.message }) };
}

export function defaultFormatError(error: unknown): APIGatewayProxyResult {
    console.error("lambda-router: unhandled error", error);
    return { statusCode: 500, body: JSON.stringify({ message: "Internal Server Error" }) };
}

export function defaultOnMetrics(metrics: RequestMetrics): void {
    console.log(JSON.stringify({ msg: "api-metrics", ...metrics }));
}

/**
 * Runs `fn`, reporting how long it took whether it resolves or rejects. A failing
 * call's duration is the one you most want on the graph, so it must not be lost.
 */
export async function timed<T>(fn: () => Promise<T>, record: (ms: number) => void): Promise<T> {
    const startedAt = Date.now();
    try {
        return await fn();
    } finally {
        record(Date.now() - startedAt);
    }
}
