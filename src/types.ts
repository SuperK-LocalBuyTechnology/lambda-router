import { Handler } from "./handler-types";
import { RequestMapper } from "./request-mapper";

export type APIMap = {
    handler: Handler<any, any, any>;
    requestMapper: RequestMapper<any>;
    options: APIOptions;
};

export type APIHandlerMap = {
    [path: string]: APIMap;
};

export type APIGatewayAuthZType =
    | "ALLOW_UNAUTHENTICATED" // No authentication required; authorize in the handler if needed
    | "ALLOW_AUTHENTICATED_CLIENTS" // Any registered client
    | "ALLOW_SPECIFIC_CLIENTS" // Pass allowedClients (client_ids) in options
    | "ALLOW_ADMIN" // Admin-only access
    | "ALLOW_ALL_CLIENT_POOLS" // All clients across every configured user pool
    | (string & {}); // any other consumer-defined policy string

export type APIOptions = {
    authType: APIGatewayAuthZType;
    allowedClients?: string[];
};
