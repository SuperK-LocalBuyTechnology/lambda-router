import { APIGatewayProxyEvent, Context } from "aws-lambda";
import { createProxyApiHandler } from "../src/create-proxy-api-handler";
import { ErrorObject } from "../src/handler-types";
import { ProxyApp } from "../src/proxy-app";
import { APIOptions } from "../src/types";

/** Mirrors what API Gateway sends for `/plugin/{teamId}/{proxy+}`. */
function proxyEvent(proxy: string, overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
        httpMethod: "GET",
        resource: "/plugin/{teamId}/{proxy+}",
        path: `/plugin/team-a/${proxy}`,
        headers: {},
        multiValueHeaders: {},
        pathParameters: { teamId: "team-a", proxy },
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as never,
        body: null,
        isBase64Encoded: false,
        ...overrides,
    };
}

const fakeContext = { awsRequestId: "req-1" } as Context;

describe("createProxyApiHandler", () => {
    it("dispatches on pathParameters.proxy rather than event.resource", async () => {
        const app = new ProxyApp();
        app.get("/orders/{orderId}", { requestMapper: () => ({}) }, async () => ({ ok: true }));
        const handler = createProxyApiHandler({ app, authorizeRequest: async () => ({}), onMetrics: () => {} });

        const result = await handler(proxyEvent("orders/o1"), fakeContext, undefined as never);

        expect(result?.statusCode).toBe(200);
        expect(JSON.parse(result!.body)).toEqual({ ok: true });
    });

    it("gives the request mapper the extracted path parameters", async () => {
        const app = new ProxyApp();
        app.get(
            "/stores/{storeId}/orders/{orderId}",
            { requestMapper: (event) => ({ seen: event.pathParameters }) },
            async (request) => request
        );
        const handler = createProxyApiHandler({ app, authorizeRequest: async () => ({}), onMetrics: () => {} });

        const result = await handler(proxyEvent("stores/s1/orders/o2"), fakeContext, undefined as never);

        // The gateway's own parameters survive alongside the extracted ones, so a team's
        // handlers can still read teamId.
        expect(JSON.parse(result!.body).seen).toEqual({
            teamId: "team-a",
            proxy: "stores/s1/orders/o2",
            storeId: "s1",
            orderId: "o2",
        });
    });

    it("404s when no route matches", async () => {
        const app = new ProxyApp();
        const handler = createProxyApiHandler({ app, authorizeRequest: async () => ({}), onMetrics: () => {} });

        const result = await handler(proxyEvent("nope"), fakeContext, undefined as never);

        expect(result?.statusCode).toBe(404);
        expect(JSON.parse(result!.body)).toEqual({ message: "No handler for /nope" });
    });

    it("short-circuits when authorization returns an ErrorObject", async () => {
        const app = new ProxyApp();
        const handlerFn = jest.fn(async () => ({ ok: true }));
        app.get("/orders", { requestMapper: () => ({}) }, handlerFn);
        const handler = createProxyApiHandler({
            app,
            authorizeRequest: async () => new ErrorObject(403, "Forbidden"),
            onMetrics: () => {},
        });

        const result = await handler(proxyEvent("orders"), fakeContext, undefined as never);

        expect(result?.statusCode).toBe(403);
        expect(JSON.parse(result!.body)).toEqual({ message: "Forbidden" });
        expect(handlerFn).not.toHaveBeenCalled();
    });

    it("passes the matched route's options to authorizeRequest", async () => {
        const app = new ProxyApp();
        app.get("/open", { requestMapper: () => ({}) }, async () => ({ ok: true }), {
            authType: "ALLOW_UNAUTHENTICATED",
        });
        const authorizeRequest = jest.fn(async (_event: APIGatewayProxyEvent, _options: APIOptions) => ({}));
        const handler = createProxyApiHandler({ app, authorizeRequest, onMetrics: () => {} });

        await handler(proxyEvent("open"), fakeContext, undefined as never);

        expect(authorizeRequest.mock.calls[0][1]).toEqual({ authType: "ALLOW_UNAUTHENTICATED" });
    });

    it("returns an ErrorObject the handler returns", async () => {
        const app = new ProxyApp();
        app.get("/orders", { requestMapper: () => ({}) }, async () => new ErrorObject(422, "Bad input"));
        const handler = createProxyApiHandler({ app, authorizeRequest: async () => ({}), onMetrics: () => {} });

        const result = await handler(proxyEvent("orders"), fakeContext, undefined as never);

        expect(result?.statusCode).toBe(422);
    });

    it("reports the registered route in metrics, never the concrete path", async () => {
        const app = new ProxyApp();
        app.get("/orders/{orderId}/receipt", { requestMapper: () => ({}) }, async () => ({ ok: true }));
        const onMetrics = jest.fn();
        const handler = createProxyApiHandler({ app, authorizeRequest: async () => ({}), onMetrics });

        await handler(proxyEvent("orders/abc123/receipt"), fakeContext, undefined as never);
        await handler(proxyEvent("orders/def456/receipt"), fakeContext, undefined as never);

        // Two different orders must aggregate to one series, or `stats by resource`
        // degenerates into one series per id.
        expect(onMetrics.mock.calls.map((call) => call[0].resource)).toEqual([
            "/orders/{orderId}/receipt",
            "/orders/{orderId}/receipt",
        ]);
        expect(onMetrics.mock.calls[0][0]).toMatchObject({
            method: "GET",
            statusCode: 200,
            outcome: "success",
            requestId: "req-1",
        });
    });

    it("reports the request path in metrics when nothing matched", async () => {
        const app = new ProxyApp();
        const onMetrics = jest.fn();
        const handler = createProxyApiHandler({ app, authorizeRequest: async () => ({}), onMetrics });

        await handler(proxyEvent("nope"), fakeContext, undefined as never);

        expect(onMetrics.mock.calls[0][0]).toMatchObject({ resource: "/nope", outcome: "not_found", statusCode: 404 });
    });

    it("records handler timing even when the handler throws", async () => {
        const app = new ProxyApp();
        app.get("/orders", { requestMapper: () => ({}) }, async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            throw new Error("boom");
        });
        const onMetrics = jest.fn();
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        const handler = createProxyApiHandler({ app, authorizeRequest: async () => ({}), onMetrics });

        const result = await handler(proxyEvent("orders"), fakeContext, undefined as never);

        expect(result?.statusCode).toBe(500);
        expect(onMetrics.mock.calls[0][0].outcome).toBe("unhandled_error");
        expect(onMetrics.mock.calls[0][0].handlerMs).toBeGreaterThanOrEqual(20);
        consoleError.mockRestore();
    });

    it("does not let a throwing onMetrics break the response", async () => {
        const app = new ProxyApp();
        app.get("/orders", { requestMapper: () => ({}) }, async () => ({ ok: true }));
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        const handler = createProxyApiHandler({
            app,
            authorizeRequest: async () => ({}),
            onMetrics: () => {
                throw new Error("metrics backend down");
            },
        });

        const result = await handler(proxyEvent("orders"), fakeContext, undefined as never);

        expect(result?.statusCode).toBe(200);
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it("treats a missing proxy parameter as the root path", async () => {
        const app = new ProxyApp();
        app.get("/", { requestMapper: () => ({}) }, async () => ({ root: true }));
        const handler = createProxyApiHandler({ app, authorizeRequest: async () => ({}), onMetrics: () => {} });

        const result = await handler(
            proxyEvent("", { pathParameters: { teamId: "team-a" } }),
            fakeContext,
            undefined as never
        );

        expect(result?.statusCode).toBe(200);
        expect(JSON.parse(result!.body)).toEqual({ root: true });
    });
});
