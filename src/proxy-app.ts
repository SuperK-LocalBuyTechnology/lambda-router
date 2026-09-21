import { MatchFunction, match } from "path-to-regexp";
import { HTTPMethod } from "./app";
import { Handler } from "./handler-types";
import { RequestMapper } from "./request-mapper";
import { APIOptions } from "./types";

const DEFAULT_OPTIONS: Readonly<APIOptions> = Object.freeze({ authType: "ALLOW_AUTHENTICATED_CLIENTS" });

interface ProxyRoute {
    method: HTTPMethod;
    /** The route as registered, e.g. `/orders/{orderId}/receipt`. Reported in metrics. */
    path: string;
    matcher: MatchFunction<Partial<Record<string, string | string[]>>>;
    requestMapper: RequestMapper<unknown>;
    handler: Handler<never, unknown, never>;
    options: APIOptions;
}

export interface MatchedProxyRoute<TRequest, TResponse, TAuthCtx> {
    path: string;
    requestMapper: RequestMapper<TRequest>;
    handler: Handler<TRequest, TResponse, TAuthCtx>;
    options: APIOptions;
    pathParameters: Record<string, string>;
}

/**
 * Route table for a service sitting behind a single greedy API Gateway resource
 * (`/plugin/<team-id>/{proxy+}`), where `event.resource` is the same string for every
 * request and so cannot be used to dispatch.
 *
 * Registration reads exactly like {@link App}, using the same `{param}` convention:
 *
 * ```ts
 * app.get("/orders/{orderId}/receipt", new ReceiptMapper(), getReceipt);
 * ```
 *
 * `{param}` is translated to path-to-regexp's `:param` internally and never escapes this
 * module, so the `{param}`-as-API-Gateway-resource convention the resource-mode servers
 * rely on is untouched.
 *
 * **Matching is first-registered-wins**, the same rule Express applies. path-to-regexp
 * applies no precedence of its own: `/orders/{orderId}` will happily match `/orders/new`.
 * A route with a literal segment that could also match a parameterised one must therefore
 * be registered first.
 */
export class ProxyApp {
    private routes: ProxyRoute[] = [];

    get<TRequest, TResponse, TAuthCtx = unknown>(
        path: string,
        requestMapper: RequestMapper<TRequest>,
        handler: Handler<TRequest, TResponse, TAuthCtx>,
        options: APIOptions = DEFAULT_OPTIONS
    ) {
        this.register("GET", path, requestMapper, handler, options);
    }

    post<TRequest, TResponse, TAuthCtx = unknown>(
        path: string,
        requestMapper: RequestMapper<TRequest>,
        handler: Handler<TRequest, TResponse, TAuthCtx>,
        options: APIOptions = DEFAULT_OPTIONS
    ) {
        this.register("POST", path, requestMapper, handler, options);
    }

    put<TRequest, TResponse, TAuthCtx = unknown>(
        path: string,
        requestMapper: RequestMapper<TRequest>,
        handler: Handler<TRequest, TResponse, TAuthCtx>,
        options: APIOptions = DEFAULT_OPTIONS
    ) {
        this.register("PUT", path, requestMapper, handler, options);
    }

    delete<TRequest, TResponse, TAuthCtx = unknown>(
        path: string,
        requestMapper: RequestMapper<TRequest>,
        handler: Handler<TRequest, TResponse, TAuthCtx>,
        options: APIOptions = DEFAULT_OPTIONS
    ) {
        this.register("DELETE", path, requestMapper, handler, options);
    }

    private register<TRequest, TResponse, TAuthCtx>(
        method: HTTPMethod,
        path: string,
        requestMapper: RequestMapper<TRequest>,
        handler: Handler<TRequest, TResponse, TAuthCtx>,
        options: APIOptions
    ) {
        const pattern = path.replace(/\{([^/}]+)\}/g, ":$1");
        this.routes.push({
            method,
            path,
            matcher: match(pattern),
            requestMapper: requestMapper as RequestMapper<unknown>,
            handler: handler as unknown as Handler<never, unknown, never>,
            options,
        });
    }

    /**
     * Finds the first registered route matching this method and concrete path, and
     * extracts its path parameters. `path` is the real request path
     * (`/orders/abc123/receipt`), not the registered template.
     */
    getHandler<TRequest, TResponse, TAuthCtx>(
        method: string,
        path: string
    ): MatchedProxyRoute<TRequest, TResponse, TAuthCtx> | undefined {
        const upperMethod = method.toUpperCase();
        for (const route of this.routes) {
            if (route.method !== upperMethod) {
                continue;
            }
            const result = route.matcher(path);
            if (result === false) {
                continue;
            }
            return {
                path: route.path,
                requestMapper: route.requestMapper as RequestMapper<TRequest>,
                handler: route.handler as unknown as Handler<TRequest, TResponse, TAuthCtx>,
                options: route.options,
                pathParameters: toStringParams(result.params),
            };
        }
        return undefined;
    }

    /** Every registered route, in registration order. Useful for diagnostics and listings. */
    listRoutes(): { method: HTTPMethod; path: string; options: APIOptions }[] {
        return this.routes.map(({ method, path, options }) => ({ method, path, options }));
    }
}

/**
 * API Gateway hands mappers `pathParameters` as a flat string map. A repeated or wildcard
 * segment comes back from path-to-regexp as an array, so rejoin it into the path fragment
 * it came from rather than handing a mapper a shape it cannot expect.
 */
function toStringParams(params: Partial<Record<string, string | string[]>>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined) {
            continue;
        }
        result[key] = Array.isArray(value) ? value.join("/") : value;
    }
    return result;
}
