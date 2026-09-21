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
