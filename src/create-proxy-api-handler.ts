import { APIGatewayProxyEvent, APIGatewayProxyHandler, APIGatewayProxyResult, Context } from "aws-lambda";
import {
    RequestMetrics,
    RequestOutcome,
    defaultFormatError,
    defaultOnMetrics,
    errorResponse,
    timed,
} from "./dispatch-shared";
import { ErrorObject } from "./handler-types";
import { ProxyApp } from "./proxy-app";
import { APIOptions } from "./types";

export type AuthorizeProxyRequest<TAuthCtx> = (
    event: APIGatewayProxyEvent,
    options: APIOptions
) => Promise<TAuthCtx | ErrorObject>;

export interface CreateProxyApiHandlerOptions<TAuthCtx> {
    app: ProxyApp;
    authorizeRequest: AuthorizeProxyRequest<TAuthCtx>;
    logEvent?: (event: APIGatewayProxyEvent) => void;
    formatError?: (error: unknown) => APIGatewayProxyResult;
    /**
     * Called once per request, on every path including 404s and thrown errors.
     * Defaults to a single-line JSON log. Throwing from here is swallowed —
     * instrumentation must never turn a 200 into a 500.
     */
    onMetrics?: (metrics: RequestMetrics) => void;
}

/**
 * Dispatcher for a service behind a single greedy API Gateway resource, typically
 * `/plugin/<team-id>/{proxy+}`.
 *
 * The match path comes from `event.pathParameters.proxy` — the remainder API Gateway's
 * `{proxy+}` integration already provides — never from stripping a prefix off
 * `event.path`, which would be fragile against stage names, base-path mappings and
 * encoding. Any other path parameters the Gateway supplies (`teamId`, say) stay visible
 * to handlers through the enriched event.
 */
export function createProxyApiHandler<TAuthCtx>({
    app,
    authorizeRequest,
    logEvent,
    formatError = defaultFormatError,
    onMetrics = defaultOnMetrics,
}: CreateProxyApiHandlerOptions<TAuthCtx>): APIGatewayProxyHandler {
    return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
        const startedAt = Date.now();
        const path = "/" + (event.pathParameters?.proxy ?? "");
        let authorizeMs: number | undefined;
        let handlerMs: number | undefined;
        let outcome: RequestOutcome = "unhandled_error";
        let statusCode = 500;
        // Falls back to the request path so a 404 is still attributable; a path that
        // matched no route cannot inflate cardinality for a route that exists.
        let resource = path;

        try {
            logEvent?.(event);

            const matched = app.getHandler(event.httpMethod, path);
            if (!matched) {
                outcome = "not_found";
                statusCode = 404;
                return { statusCode, body: JSON.stringify({ message: `No handler for ${path}` }) };
            }
            resource = matched.path;

            const authResult = await timed(
                () => authorizeRequest(event, matched.options),
                (ms) => (authorizeMs = ms)
            );
            if (ErrorObject.isErrorObject(authResult)) {
                outcome = "unauthorized";
                statusCode = authResult.statusCode;
                return errorResponse(authResult);
            }

            const enrichedEvent: APIGatewayProxyEvent = {
                ...event,
                pathParameters: { ...event.pathParameters, ...matched.pathParameters },
            };
            const request = matched.requestMapper.requestMapper(enrichedEvent);
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
                    resource,
                    statusCode,
                    outcome,
                    authorizeMs,
                    handlerMs,
                    totalMs: Date.now() - startedAt,
                    requestId: context.awsRequestId,
                });
            } catch (metricsError) {
                console.error("createProxyApiHandler: onMetrics threw", metricsError);
            }
        }
    };
}
