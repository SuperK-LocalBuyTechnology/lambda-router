import { Handler } from "./handler-types";
import { RequestMapper } from "./request-mapper";
import { APIHandlerMap, APIMap, APIOptions } from "./types";

const DEFAULT_OPTIONS: Readonly<APIOptions> = Object.freeze({ authType: "ALLOW_AUTHENTICATED_CLIENTS" });
type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE";

export class App {
    APIS: {
        GET: APIHandlerMap;
        POST: APIHandlerMap;
        PUT: APIHandlerMap;
        DELETE: APIHandlerMap;
    } = {
        GET: Object.create(null),
        POST: Object.create(null),
        PUT: Object.create(null),
        DELETE: Object.create(null),
    };

    get<TRequest, TResponse, TAuthCtx = unknown>(
        path: string,
        requestMapper: RequestMapper<TRequest>,
        handler: Handler<TRequest, TResponse, TAuthCtx>,
        options: APIOptions = DEFAULT_OPTIONS
    ) {
        this.APIS.GET[path] = { handler, requestMapper, options };
    }

    post<TRequest, TResponse, TAuthCtx = unknown>(
        path: string,
        requestMapper: RequestMapper<TRequest>,
        handler: Handler<TRequest, TResponse, TAuthCtx>,
        options: APIOptions = DEFAULT_OPTIONS
    ) {
        this.APIS.POST[path] = { handler, requestMapper, options };
    }

    put<TRequest, TResponse, TAuthCtx = unknown>(
        path: string,
        requestMapper: RequestMapper<TRequest>,
        handler: Handler<TRequest, TResponse, TAuthCtx>,
        options: APIOptions = DEFAULT_OPTIONS
    ) {
        this.APIS.PUT[path] = { handler, requestMapper, options };
    }

    delete<TRequest, TResponse, TAuthCtx = unknown>(
        path: string,
        requestMapper: RequestMapper<TRequest>,
        handler: Handler<TRequest, TResponse, TAuthCtx>,
        options: APIOptions = DEFAULT_OPTIONS
    ) {
        this.APIS.DELETE[path] = { handler, requestMapper, options };
    }

    getHandler<TRequest, TResponse, TAuthCtx>(
        method: HTTPMethod,
        path: string
    ): APIMap<TRequest, TResponse, TAuthCtx> | undefined {
        switch (method.toUpperCase()) {
            case "GET":
                return this.APIS.GET[path];
            case "POST":
                return this.APIS.POST[path];
            case "PUT":
                return this.APIS.PUT[path];
            case "DELETE":
                return this.APIS.DELETE[path];
            default:
                return undefined;
        }
    }
}
