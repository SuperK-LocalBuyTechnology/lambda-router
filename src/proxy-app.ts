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
 * Routes cannot overlap. path-to-regexp applies no precedence of its own, so
 * `/orders/{orderId}` would happily match `/orders/new` and the winner would come down to
 * which was registered first. Registering a route that could match the same request as an
 * existing one throws instead, which leaves matching order-independent.
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
        const matcher = compileMatcher(method, path);
        assertNoOverlap(this.routes, method, path);
        this.routes.push({
            method,
            path,
            matcher,
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

const PARAM_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RAW_PARAM_SYNTAX = /:[A-Za-z_$][A-Za-z0-9_$]*/;
const PARAM_SEGMENT = /^\{[^}]+\}$/;

/**
 * Rejects a route that could match the same request path as one already registered —
 * `/order/new` against `/order/{orderId}`, say.
 *
 * Matching scans in registration order, so an overlapping pair does not fail, it just
 * resolves to whichever was registered first. That makes behaviour depend on the order
 * of lines in a registry file, which is a poor thing to discover in production. Refusing
 * the pair outright makes matching order-independent by construction.
 *
 * Two routes overlap when they have the same number of segments and no position holds
 * two different literals — a parameter matches any single segment, so it overlaps
 * whatever sits opposite it. `/order/new` and `/order/old` are therefore fine, and so
 * are `/order/{id}/items` and `/order/new/history`.
 */
function assertNoOverlap(routes: ProxyRoute[], method: HTTPMethod, path: string): void {
    const segments = path.split("/");
    for (const route of routes) {
        if (route.method !== method) {
            continue;
        }
        const existing = route.path.split("/");
        if (existing.length !== segments.length) {
            continue;
        }
        const overlaps = segments.every(
            (segment, index) =>
                PARAM_SEGMENT.test(segment) || PARAM_SEGMENT.test(existing[index]) || segment === existing[index]
        );
        if (!overlaps) {
            continue;
        }
        if (route.path === path) {
            throw new Error(`lambda-router: cannot register ${method} ${path} — it is already registered.`);
        }
        throw new Error(
            `lambda-router: cannot register ${method} ${path} — it overlaps ${method} ${route.path}, which is ` +
                `already registered. A request can match both, so which one handles it would depend on the ` +
                `order these were registered in. Give them paths that cannot match the same request.`
        );
    }
}

/**
 * Validates a route as the caller wrote it, then compiles it.
 *
 * Routes are registered at module load, so anything that throws here takes the Lambda
 * down at cold start and 502s every request. Reporting against the translated pattern
 * would name a string the caller never wrote (`{path+}` surfacing as `:path+`), so every
 * message quotes the original and says what to write instead.
 */
function compileMatcher(method: HTTPMethod, path: string): MatchFunction<Partial<Record<string, string | string[]>>> {
    const route = `${method} ${path}`;

    for (const [group, name] of path.matchAll(/\{([^}]*)\}/g)) {
        if (PARAM_NAME.test(name)) {
            continue;
        }
        if (name.startsWith("*")) {
            throw new Error(
                `lambda-router: cannot register ${route}. "${group}" would match any number of path ` +
                    `segments, which is not supported. Use {${name.slice(1) || "name"}} to capture exactly one.`
            );
        }
        const modified = name.match(/^([A-Za-z_$][A-Za-z0-9_$]*)[+*?]$/);
        if (modified) {
            throw new Error(
                `lambda-router: cannot register ${route}. "${group}" is not supported — the +, * and ? ` +
                    `modifiers do not exist in this router. Write "{${modified[1]}}" to match exactly one ` +
                    `path segment.`
            );
        }
        throw new Error(
            `lambda-router: cannot register ${route}. "${group}" is not a valid parameter. Write {name}, ` +
                `where name starts with a letter and contains only letters, digits or underscores.`
        );
    }

    const rawParam = path.match(RAW_PARAM_SYNTAX);
    if (rawParam) {
        const suggestion = path.replace(/:([A-Za-z_$][A-Za-z0-9_$]*)/g, "{$1}");
        throw new Error(
            `lambda-router: cannot register ${route}. Routes use {name}, not ${rawParam[0]} — ` +
                `write "${suggestion}".`
        );
    }

    if (path.includes("*")) {
        throw new Error(
            `lambda-router: cannot register ${route}. Wildcards are not supported. Use {name} to capture ` +
                `one path segment, for example "/files/{name}".`
        );
    }

    const pattern = path.replace(/\{([^/}]+)\}/g, ":$1");
    try {
        return match(pattern);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`lambda-router: cannot register ${route}. ${detail}`);
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
