import { APIGatewayProxyEvent, APIGatewayProxyHandler, APIGatewayProxyResult, Context } from "aws-lambda";
import { App, HTTPMethod } from "./app";
import { ErrorObject } from "./handler-types";
import { APIOptions } from "./types";

export type AuthorizeRequest<TAuthCtx> = (
    event: APIGatewayProxyEvent,
    options: APIOptions
) => Promise<TAuthCtx | ErrorObject>;

/**
 * How a request ended. Distinguishes the four failure modes so a metrics query
 * can tell "clients are sending bad auth" apart from "the handler is broken".
 */
export type RequestOutcome = "success" | "not_found" | "unauthorized" | "handler_error" | "unhandled_error";

export interface RequestMetrics {
    method: string;
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

export interface CreateApiHandlerOptions<TAuthCtx> {
    app: App;
    authorizeRequest: AuthorizeRequest<TAuthCtx>;
    logEvent?: (event: APIGatewayProxyEvent) => void;
    formatError?: (error: unknown) => APIGatewayProxyResult;
    /**
     * Called once per request, on every path including 404s and thrown errors.
     * Defaults to a single-line JSON log. Throwing from here is swallowed —
     * instrumentation must never turn a 200 into a 500.
     */
    onMetrics?: (metrics: RequestMetrics) => void;
}

function errorResponse(error: ErrorObject): APIGatewayProxyResult {
    return { statusCode: error.statusCode, body: JSON.stringify({ message: error.message }) };
}

function defaultFormatError(error: unknown): APIGatewayProxyResult {
    console.error("createApiHandler: unhandled error", error);
    return { statusCode: 500, body: JSON.stringify({ message: "Internal Server Error" }) };
}

function defaultOnMetrics(metrics: RequestMetrics): void {
    console.log(JSON.stringify({ msg: "api-metrics", ...metrics }));
}

/**
 * Runs `fn`, reporting how long it took whether it resolves or rejects. A failing
 * call's duration is the one you most want on the graph, so it must not be lost.
 */
async function timed<T>(fn: () => Promise<T>, record: (ms: number) => void): Promise<T> {
    const startedAt = Date.now();
    try {
        return await fn();
    } finally {
        record(Date.now() - startedAt);
    }
}

export function createApiHandler<TAuthCtx>({
    app,
    authorizeRequest,
    logEvent,
    formatError = defaultFormatError,
    onMetrics = defaultOnMetrics,
}: CreateApiHandlerOptions<TAuthCtx>): APIGatewayProxyHandler {
    return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
        const startedAt = Date.now();
        let authorizeMs: number | undefined;
        let handlerMs: number | undefined;
        let outcome: RequestOutcome = "unhandled_error";
        let statusCode = 500;

        try {
            logEvent?.(event);

            const matched = app.getHandler(event.httpMethod as HTTPMethod, event.resource);
            if (!matched) {
                outcome = "not_found";
                statusCode = 404;
                return {
                    statusCode,
                    body: JSON.stringify({ message: `There is no handler registered for this ${event.resource}.` }),
                };
            }

            const authResult = await timed(
                () => authorizeRequest(event, matched.options),
                (ms) => (authorizeMs = ms)
            );
            if (ErrorObject.isErrorObject(authResult)) {
                outcome = "unauthorized";
                statusCode = authResult.statusCode;
                return errorResponse(authResult);
            }

            const request = matched.requestMapper.requestMapper(event);
            const result = await timed(
                () => matched.handler(request, authResult, context),
                (ms) => (handlerMs = ms)
            );
            if (ErrorObject.isErrorObject(result)) {
                outcome = "handler_error";
                statusCode = result.statusCode;
                return errorResponse(result);
            }

            outcome = "success";
            statusCode = 200;
            return { statusCode, body: JSON.stringify(result) };
        } catch (error) {
            if (ErrorObject.isErrorObject(error)) {
                outcome = "handler_error";
                statusCode = error.statusCode;
                return errorResponse(error);
            }
            const response = formatError(error);
            outcome = "unhandled_error";
            statusCode = response.statusCode;
            return response;
        } finally {
            try {
                onMetrics({
                    method: event.httpMethod,
                    resource: event.resource,
                    statusCode,
                    outcome,
                    authorizeMs,
                    handlerMs,
                    totalMs: Date.now() - startedAt,
                    requestId: context.awsRequestId,
                });
            } catch (metricsError) {
                console.error("createApiHandler: onMetrics threw", metricsError);
            }
        }
    };
}
