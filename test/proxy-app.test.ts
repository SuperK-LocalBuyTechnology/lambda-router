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

    it("refuses a route that could match the same request as an existing one", () => {
        const app = new ProxyApp();
        app.get("/orders/{orderId}", noopMapper, noopHandler);

        expect(() => app.get("/orders/new", noopMapper, noopHandler)).toThrow(
            "lambda-router: cannot register GET /orders/new — it overlaps GET /orders/{orderId}, which is " +
                "already registered. A request can match both, so which one handles it would depend on the " +
                "order these were registered in. Give them paths that cannot match the same request."
        );
    });

    it("refuses the overlapping pair in either registration order", () => {
        const literalFirst = new ProxyApp();
        literalFirst.get("/orders/new", noopMapper, noopHandler);

        expect(() => literalFirst.get("/orders/{orderId}", noopMapper, noopHandler)).toThrow("it overlaps");
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

describe("ProxyApp overlap detection", () => {
    const app = () => new ProxyApp();

    it("refuses two parameters differing only in name, which is a duplicate route", () => {
        const a = app();
        a.get("/orders/{orderId}", noopMapper, noopHandler);

        expect(() => a.get("/orders/{id}", noopMapper, noopHandler)).toThrow("it overlaps");
    });

    it("refuses the exact same route twice, and says so plainly", () => {
        const a = app();
        a.get("/orders/{orderId}", noopMapper, noopHandler);

        expect(() => a.get("/orders/{orderId}", noopMapper, noopHandler)).toThrow(
            "lambda-router: cannot register GET /orders/{orderId} — it is already registered."
        );
    });

    it("allows two different literals in the same position", () => {
        const a = app();
        a.get("/orders/new", noopMapper, noopHandler);

        expect(() => a.get("/orders/draft", noopMapper, noopHandler)).not.toThrow();
    });

    it("allows routes that differ in a later segment, even with a parameter earlier", () => {
        const a = app();
        a.get("/orders/{orderId}/items", noopMapper, noopHandler);

        // Nothing can match both: the last segment is two different literals.
        expect(() => a.get("/orders/new/history", noopMapper, noopHandler)).not.toThrow();
    });

    it("allows routes with different segment counts", () => {
        const a = app();
        a.get("/orders/{orderId}", noopMapper, noopHandler);

        expect(() => a.get("/orders/{orderId}/items", noopMapper, noopHandler)).not.toThrow();
        expect(() => a.get("/orders", noopMapper, noopHandler)).not.toThrow();
    });

    it("scopes the check to one method, so the same path under another verb is fine", () => {
        const a = app();
        a.get("/orders/{orderId}", noopMapper, noopHandler);

        expect(() => a.post("/orders/new", noopMapper, noopHandler)).not.toThrow();
        expect(() => a.put("/orders/{orderId}", noopMapper, noopHandler)).not.toThrow();
    });

    it("leaves matching order-independent, since no two routes can both match", () => {
        const a = app();
        a.get("/orders/{orderId}", noopMapper, noopHandler);
        a.get("/orders/{orderId}/items", noopMapper, noopHandler);
        a.get("/customers/{customerId}", noopMapper, noopHandler);

        expect(a.getHandler("GET", "/orders/o1")?.path).toBe("/orders/{orderId}");
        expect(a.getHandler("GET", "/orders/o1/items")?.path).toBe("/orders/{orderId}/items");
        expect(a.getHandler("GET", "/customers/c1")?.path).toBe("/customers/{customerId}");
    });
});
