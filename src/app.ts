import { Handler } from "./handler-types";
import { RequestMapper } from "./request-mapper";
import { APIHandlerMap, APIMap, APIOptions } from "./types";

const DEFAULT_OPTIONS: APIOptions = Object.freeze({ authType: "ALLOW_AUTHENTICATED_CLIENTS" });

export class App {
    APIS: {
        GET: APIHandlerMap;
        POST: APIHandlerMap;
        PUT: APIHandlerMap;
        DELETE: APIHandlerMap;
    } = {
        GET: {},
        POST: {},
        PUT: {},
        DELETE: {},
    };

    get(
        path: string,
        requestMapper: RequestMapper<any>,
        handler: Handler<any, any, any>,
        options: APIOptions = DEFAULT_OPTIONS
    ) {
        this.APIS.GET[path] = { handler, requestMapper, options };
    }

    post(
        path: string,
        requestMapper: RequestMapper<any>,
        handler: Handler<any, any, any>,
        options: APIOptions = DEFAULT_OPTIONS
    ) {
        this.APIS.POST[path] = { handler, requestMapper, options };
    }

    put(
        path: string,
        requestMapper: RequestMapper<any>,
        handler: Handler<any, any, any>,
        options: APIOptions = DEFAULT_OPTIONS
    ) {
        this.APIS.PUT[path] = { handler, requestMapper, options };
    }

    delete(
        path: string,
        requestMapper: RequestMapper<any>,
        handler: Handler<any, any, any>,
        options: APIOptions = DEFAULT_OPTIONS
    ) {
        this.APIS.DELETE[path] = { handler, requestMapper, options };
    }

    getHandler(method: string, path: string): APIMap | undefined {
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
