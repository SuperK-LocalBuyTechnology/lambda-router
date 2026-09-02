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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const APIGatewayAuthZTypes: {
    ALLOW_UNAUTHENTICATED: string; // No authentication required; authorize in the handler if needed
    ALLOW_AUTHENTICATED_CLIENTS: string; // Any registered client
    ALLOW_SPECIFIC_CLIENTS: string; // Pass allowedClients (client_ids) in options
    ALLOW_ADMIN: string; // Admin-only access
    ALLOW_ALL_CLIENT_POOLS: string; // All clients across every configured user pool
};

export type APIGatewayAuthZType = keyof typeof APIGatewayAuthZTypes;

export type APIOptions = {
    authType: APIGatewayAuthZType;
    allowedClients?: string[];
};
