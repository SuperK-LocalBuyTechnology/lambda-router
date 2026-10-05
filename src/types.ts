import { Handler } from "./handler-types";
import { RequestMapper } from "./request-mapper";
import { ResponseMapper } from "./response-mapper";

export type APIMap<TRequest, TResponse, TAuthCtx> = {
    handler: Handler<TRequest, TResponse, TAuthCtx>;
    requestMapper: RequestMapper<TRequest>;
    options: APIOptions<TResponse, TAuthCtx>;
};

export type APIHandlerMap = {
    [path: string]: APIMap<any, any, any>;
};

export const API_GATEWAY_NAMED_AUTHZ_TYPES = [
    "ALLOW_UNAUTHENTICATED", // No authentication required; authorize in the handler if needed
    "ALLOW_AUTHENTICATED_CLIENTS", // Any registered client
    "ALLOW_SPECIFIC_CLIENTS", // Requires allowedClients (client_ids) in options
    "ALLOW_ADMIN", // Admin-only access
    "ALLOW_ALL_CLIENT_POOLS", // All clients across every configured user pool
] as const;

export type APIGatewayNamedAuthZType = (typeof API_GATEWAY_NAMED_AUTHZ_TYPES)[number];
export type APIGatewayAuthZType = APIGatewayNamedAuthZType | (string & {});

export type APIOptions<TResponse = any, TAuthCtx = any> = {
    /** Defaults to `ALLOW_AUTHENTICATED_CLIENTS`. */
    authType?: APIGatewayAuthZType;
    allowedClients?: string[];
    /** Trims/reshapes the handler's successful result before it is sent. Absent = sent as returned. */
    responseMapper?: ResponseMapper<TResponse, unknown, TAuthCtx>;
};

const DEFAULT_AUTH_TYPE: APIGatewayNamedAuthZType = "ALLOW_AUTHENTICATED_CLIENTS";

/** Fills in the default `authType` (rejecting `allowedClients` without one, which would silently open the route), so a stored route's options always carry one even if only e.g. `responseMapper` was passed. */
export function resolveOptions<TResponse, TAuthCtx>(
    options: APIOptions<TResponse, TAuthCtx> = {}
): APIOptions<TResponse, TAuthCtx> {
    if (options.allowedClients && options.authType === undefined) {
        throw new Error(
            `lambda-router: allowedClients is set but authType is not, so the route would default to ` +
                `${DEFAULT_AUTH_TYPE} and ignore allowedClients. Pass authType: "ALLOW_SPECIFIC_CLIENTS".`
        );
    }
    return { ...options, authType: options.authType ?? DEFAULT_AUTH_TYPE };
}
