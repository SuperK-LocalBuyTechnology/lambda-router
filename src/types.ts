import { Handler } from "./handler-types";
import { RequestMapper } from "./request-mapper";

export type APIMap<TRequest, TResponse, TAuthCtx> = {
    handler: Handler<TRequest, TResponse, TAuthCtx>;
    requestMapper: RequestMapper<TRequest>;
    options: APIOptions;
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

export type APIOptions = {
    authType: APIGatewayAuthZType;
    allowedClients?: string[];
};
