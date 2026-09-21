import { ProxyApp } from "../src/proxy-app";

const noopMapper = { requestMapper: () => ({}) };
const noopHandler = async () => ({ ok: true });

describe("ProxyApp", () => {
    it("matches a parameterised route and extracts the parameter", () => {
        const app = new ProxyApp();
        app.get("/orders/{orderId}/receipt", noopMapper, noopHandler);

        const matched = app.getHandler("GET", "/orders/abc123/receipt");

        expect(matched?.path).toBe("/orders/{orderId}/receipt");
        expect(matched?.pathParameters).toEqual({ orderId: "abc123" });
    });

    it("extracts several parameters from one route", () => {
        const app = new ProxyApp();
        app.get("/stores/{storeId}/orders/{orderId}", noopMapper, noopHandler);

        expect(app.getHandler("GET", "/stores/s1/orders/o2")?.pathParameters).toEqual({
            storeId: "s1",
            orderId: "o2",
        });
    });

    it("returns undefined when nothing matches", () => {
        const app = new ProxyApp();
        app.get("/orders/{orderId}", noopMapper, noopHandler);

        expect(app.getHandler("GET", "/orders/abc/extra")).toBeUndefined();
        expect(app.getHandler("GET", "/unknown")).toBeUndefined();
    });

    it("does not match a route registered under a different method", () => {
        const app = new ProxyApp();
        app.post("/orders", noopMapper, noopHandler);

        expect(app.getHandler("GET", "/orders")).toBeUndefined();
        expect(app.getHandler("POST", "/orders")).toBeDefined();
    });

    it("treats the method case-insensitively", () => {
        const app = new ProxyApp();
        app.put("/orders/{orderId}", noopMapper, noopHandler);

        expect(app.getHandler("put", "/orders/o1")).toBeDefined();
    });

    it("resolves ambiguity by registration order, not by literal-beats-parameter", () => {
        const literalFirst = new ProxyApp();
        literalFirst.get("/orders/new", noopMapper, noopHandler);
        literalFirst.get("/orders/{orderId}", noopMapper, noopHandler);

        expect(literalFirst.getHandler("GET", "/orders/new")?.path).toBe("/orders/new");

        // Registered the other way round the parameterised route wins, because
        // path-to-regexp applies no precedence of its own. This is the documented rule,
        // and the reason a literal route must be registered first.
        const paramFirst = new ProxyApp();
        paramFirst.get("/orders/{orderId}", noopMapper, noopHandler);
        paramFirst.get("/orders/new", noopMapper, noopHandler);

        expect(paramFirst.getHandler("GET", "/orders/new")?.path).toBe("/orders/{orderId}");
        expect(paramFirst.getHandler("GET", "/orders/new")?.pathParameters).toEqual({ orderId: "new" });
    });

    it("URL-decodes captured parameters, as API Gateway does for resource routes", () => {
        const app = new ProxyApp();
        app.get("/search/{term}", noopMapper, noopHandler);

        expect(app.getHandler("GET", "/search/a%20b")?.pathParameters).toEqual({ term: "a b" });
    });

    it("carries the registered options through to the match", () => {
        const app = new ProxyApp();
        app.get("/open", noopMapper, noopHandler, { authType: "ALLOW_UNAUTHENTICATED" });
        app.get("/closed", noopMapper, noopHandler);

        expect(app.getHandler("GET", "/open")?.options.authType).toBe("ALLOW_UNAUTHENTICATED");
        expect(app.getHandler("GET", "/closed")?.options.authType).toBe("ALLOW_AUTHENTICATED_CLIENTS");
    });

    it("lists routes in registration order", () => {
        const app = new ProxyApp();
        app.get("/a", noopMapper, noopHandler);
        app.post("/b/{id}", noopMapper, noopHandler);

        expect(app.listRoutes().map((route) => `${route.method} ${route.path}`)).toEqual(["GET /a", "POST /b/{id}"]);
    });
});

describe("ProxyApp route validation", () => {
    // Routes register at module load, so a bad one takes the Lambda down at cold start
    // and 502s every request. The message has to name the route as written and say what
    // to write instead.
    const register = (path: string) => () => new ProxyApp().get(path, noopMapper, noopHandler);

    it("rejects the API Gateway {proxy+} spelling with the route as the caller wrote it", () => {
        expect(register("/files/{path+}")).toThrow(
            'lambda-router: cannot register GET /files/{path+}. "{path+}" is not supported — the +, * and ? ' +
                'modifiers do not exist in this router. Write "{path}" to match exactly one path segment.'
        );
    });

    it("rejects the other removed modifiers too", () => {
        expect(register("/files/{path*}")).toThrow('Write "{path}"');
        expect(register("/files/{path?}")).toThrow('Write "{path}"');
    });

    it("rejects a brace wildcard, suggesting the single-segment form", () => {
        expect(register("/files/{*rest}")).toThrow(
            'lambda-router: cannot register GET /files/{*rest}. "{*rest}" would match any number of path ' +
                "segments, which is not supported. Use {rest} to capture exactly one."
        );
    });

    it("rejects a bare wildcard, which path-to-regexp would otherwise accept silently", () => {
        expect(register("/files/*rest")).toThrow("Wildcards are not supported");
    });

    it("rejects an empty parameter, which path-to-regexp treats as a literal", () => {
        expect(register("/files/{}")).toThrow('"{}" is not a valid parameter');
    });

    it("rejects raw :param syntax and suggests the braced rewrite", () => {
        expect(register("/orders/:orderId/items/:itemId")).toThrow(
            "lambda-router: cannot register GET /orders/:orderId/items/:itemId. Routes use {name}, not " +
                ':orderId — write "/orders/{orderId}/items/{itemId}".'
        );
    });

    it("still accepts the supported syntax", () => {
        expect(register("/orders/{orderId}/items/{itemId}")).not.toThrow();
        expect(register("/orders")).not.toThrow();
        expect(register("/")).not.toThrow();
    });

    it("validates on every verb, not just get", () => {
        const app = new ProxyApp();
        expect(() => app.post("/a/{b+}", noopMapper, noopHandler)).toThrow("not supported");
        expect(() => app.put("/a/{b+}", noopMapper, noopHandler)).toThrow("not supported");
        expect(() => app.delete("/a/{b+}", noopMapper, noopHandler)).toThrow("not supported");
    });
});
