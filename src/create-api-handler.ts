import { APIGatewayProxyEvent, APIGatewayProxyHandler, APIGatewayProxyResult, Context } from "aws-lambda";
import { App } from "./app";
import { ErrorObject } from "./handler-types";
import { APIOptions } from "./types";

export type AuthorizeRequest<TAuthCtx> = (
    event: APIGatewayProxyEvent,
    options: APIOptions
) => Promise<TAuthCtx | ErrorObject>;

export interface CreateApiHandlerOptions<TAuthCtx> {
    app: App;
    authorizeRequest: AuthorizeRequest<TAuthCtx>;
    logEvent?: (event: APIGatewayProxyEvent) => void;
    formatError?: (error: unknown) => APIGatewayProxyResult;
}

function errorResponse(error: ErrorObject): APIGatewayProxyResult {
    return { statusCode: error.statusCode, body: JSON.stringify({ message: error.message }) };
}

function defaultFormatError(error: unknown): APIGatewayProxyResult {
    console.error("createApiHandler: unhandled error", error);
    return { statusCode: 500, body: JSON.stringify({ message: "Internal Server Error" }) };
}

export function createApiHandler<TAuthCtx>({
    app,
    authorizeRequest,
    logEvent,
    formatError = defaultFormatError,
}: CreateApiHandlerOptions<TAuthCtx>): APIGatewayProxyHandler {
    return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
        try {
            logEvent?.(event);

            const matched = app.getHandler(event.httpMethod, event.resource);
            if (!matched) {
                return {
                    statusCode: 404,
                    body: JSON.stringify({ message: `There is no handler registered for this ${event.resource}.` }),
                };
            }

            const authResult = await authorizeRequest(event, matched.options);
            if (ErrorObject.isErrorObject(authResult)) {
                return errorResponse(authResult);
            }

            const request = matched.requestMapper.requestMapper(event);
            const result = await matched.handler(request, authResult, context);
            if (ErrorObject.isErrorObject(result)) {
                return errorResponse(result);
            }
            return { statusCode: 200, body: JSON.stringify(result) };
        } catch (error) {
            if (ErrorObject.isErrorObject(error)) {
                return errorResponse(error);
            }
            return formatError(error);
        }
    };
}
