import { APIGatewayProxyEvent, Context } from "aws-lambda";
import { App } from "../src/app";
import { createApiHandler } from "../src/create-api-handler";
import { ErrorObject } from "../src/handler-types";

function fakeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
        httpMethod: "GET",
        resource: "/widgets",
        path: "/widgets",
        headers: {},
        multiValueHeaders: {},
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        body: null,
        isBase64Encoded: false,
        ...overrides,
    };
}

const fakeContext = {} as Context;

describe("createApiHandler", () => {
    it("returns 404 when no route matches", async () => {
        const app = new App();
        const handler = createApiHandler({ app, authorizeRequest: async () => ({}) });

        const result = await handler(fakeEvent({ resource: "/unknown" }), fakeContext, undefined as any);

        expect(result?.statusCode).toBe(404);
    });

    it("dispatches to the matched handler and returns 200 with its JSON result", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({ id: "abc" }) }, async (request) => ({ received: request.id }));
        const handler = createApiHandler({ app, authorizeRequest: async () => ({ userId: "u1" }) });

        const result = await handler(fakeEvent(), fakeContext, undefined as any);

        expect(result?.statusCode).toBe(200);
        expect(JSON.parse(result!.body)).toEqual({ received: "abc" });
    });

    it("short-circuits with the ErrorObject's status/message when authorization fails", async () => {
        const app = new App();
        const handlerFn = jest.fn(async () => ({ ok: true }));
        app.get("/widgets", { requestMapper: () => ({}) }, handlerFn);
        const handler = createApiHandler({
            app,
            authorizeRequest: async () => new ErrorObject(403, "Forbidden"),
        });

        const result = await handler(fakeEvent(), fakeContext, undefined as any);

        expect(result?.statusCode).toBe(403);
        expect(JSON.parse(result!.body)).toEqual({ message: "Forbidden" });
        expect(handlerFn).not.toHaveBeenCalled();
    });

    it("returns the ErrorObject's status/message when the handler itself returns one", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => new ErrorObject(409, "Conflict"));
        const handler = createApiHandler({ app, authorizeRequest: async () => ({}) });

        const result = await handler(fakeEvent(), fakeContext, undefined as any);

        expect(result?.statusCode).toBe(409);
        expect(JSON.parse(result!.body)).toEqual({ message: "Conflict" });
    });

    it("uses the default formatError (500) when the handler throws and none is provided", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => {
            throw new Error("kaboom");
        });
        const handler = createApiHandler({ app, authorizeRequest: async () => ({}) });

        const result = await handler(fakeEvent(), fakeContext, undefined as any);

        expect(result?.statusCode).toBe(500);
    });

    it("uses a custom formatError when the handler throws and one is provided", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => {
            throw new Error("kaboom");
        });
        const handler = createApiHandler({
            app,
            authorizeRequest: async () => ({}),
            formatError: () => ({ statusCode: 502, body: JSON.stringify({ message: "custom" }) }),
        });

        const result = await handler(fakeEvent(), fakeContext, undefined as any);

        expect(result?.statusCode).toBe(502);
        expect(JSON.parse(result!.body)).toEqual({ message: "custom" });
    });

    it("calls logEvent with the raw event when provided", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => ({ ok: true }));
        const logEvent = jest.fn();
        const handler = createApiHandler({ app, authorizeRequest: async () => ({}), logEvent });

        const event = fakeEvent();
        await handler(event, fakeContext, undefined as any);

        expect(logEvent).toHaveBeenCalledWith(event);
    });

    it("passes the matched route's options to authorizeRequest", async () => {
        const app = new App();
        const options = { authType: "ALLOW_UNAUTHENTICATED" as const };
        app.get("/widgets", { requestMapper: () => ({}) }, async () => ({ ok: true }), options);
        const authorizeRequest = jest.fn(async () => ({}));
        const handler = createApiHandler({ app, authorizeRequest });

        await handler(fakeEvent(), fakeContext, undefined as any);

        expect(authorizeRequest).toHaveBeenCalledWith(expect.objectContaining({ resource: "/widgets" }), options);
    });

    it("passes the auth context and lambda context to the handler", async () => {
        const app = new App();
        const handlerFn = jest.fn(async () => ({ ok: true }));
        app.get("/widgets", { requestMapper: () => ({ id: "abc" }) }, handlerFn);
        const authContext = { userId: "u1" };
        const lambdaContext = { awsRequestId: "req-1" } as Context;
        const handler = createApiHandler({ app, authorizeRequest: async () => authContext });

        await handler(fakeEvent(), lambdaContext, undefined as any);

        expect(handlerFn).toHaveBeenCalledWith({ id: "abc" }, authContext, lambdaContext);
    });

    it("routes an authorizeRequest throw through formatError", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => ({ ok: true }));
        const handler = createApiHandler({
            app,
            authorizeRequest: async () => {
                throw new Error("auth blew up");
            },
        });

        const result = await handler(fakeEvent(), fakeContext, undefined as any);

        expect(result?.statusCode).toBe(500);
    });

    it("routes a requestMapper throw through formatError", async () => {
        const app = new App();
        app.get(
            "/widgets",
            {
                requestMapper: () => {
                    throw new Error("bad request shape");
                },
            },
            async () => ({ ok: true })
        );
        const handler = createApiHandler({ app, authorizeRequest: async () => ({}) });

        const result = await handler(fakeEvent(), fakeContext, undefined as any);

        expect(result?.statusCode).toBe(500);
    });

    it("honors a thrown ErrorObject without calling formatError", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => {
            throw new ErrorObject(404, "Not found");
        });
        const formatError = jest.fn();
        const handler = createApiHandler({ app, authorizeRequest: async () => ({}), formatError });

        const result = await handler(fakeEvent(), fakeContext, undefined as any);

        expect(result).toEqual({ statusCode: 404, body: JSON.stringify({ message: "Not found" }) });
        expect(formatError).not.toHaveBeenCalled();
    });
});

describe("createApiHandler request metrics", () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const contextWithId = { awsRequestId: "req-123" } as Context;

    it("reports a success with both phase timings and the request id", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => ({ ok: true }));
        const onMetrics = jest.fn();
        const handler = createApiHandler({ app, authorizeRequest: async () => ({}), onMetrics });

        await handler(fakeEvent(), contextWithId, undefined as any);

        expect(onMetrics).toHaveBeenCalledTimes(1);
        expect(onMetrics.mock.calls[0][0]).toMatchObject({
            method: "GET",
            resource: "/widgets",
            statusCode: 200,
            outcome: "success",
            requestId: "req-123",
        });
        const metrics = onMetrics.mock.calls[0][0];
        expect(typeof metrics.authorizeMs).toBe("number");
        expect(typeof metrics.handlerMs).toBe("number");
        expect(typeof metrics.totalMs).toBe("number");
    });

    it("actually measures elapsed time rather than reporting a constant", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => {
            await sleep(30);
            return { ok: true };
        });
        const onMetrics = jest.fn();
        const handler = createApiHandler({
            app,
            authorizeRequest: async () => {
                await sleep(30);
                return {};
            },
            onMetrics,
        });

        await handler(fakeEvent(), contextWithId, undefined as any);

        const metrics = onMetrics.mock.calls[0][0];
        expect(metrics.authorizeMs).toBeGreaterThanOrEqual(20);
        expect(metrics.handlerMs).toBeGreaterThanOrEqual(20);
        expect(metrics.totalMs).toBeGreaterThanOrEqual(metrics.authorizeMs + metrics.handlerMs);
    });

    it("reports a 404 with no phase timings", async () => {
        const app = new App();
        const onMetrics = jest.fn();
        const handler = createApiHandler({ app, authorizeRequest: async () => ({}), onMetrics });

        await handler(fakeEvent({ resource: "/unknown" }), contextWithId, undefined as any);

        expect(onMetrics.mock.calls[0][0]).toMatchObject({
            resource: "/unknown",
            statusCode: 404,
            outcome: "not_found",
        });
        expect(onMetrics.mock.calls[0][0].authorizeMs).toBeUndefined();
        expect(onMetrics.mock.calls[0][0].handlerMs).toBeUndefined();
    });

    it("reports a rejected authorization as unauthorized, with no handler timing", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => ({ ok: true }));
        const onMetrics = jest.fn();
        const handler = createApiHandler({
            app,
            authorizeRequest: async () => new ErrorObject(403, "Forbidden"),
            onMetrics,
        });

        await handler(fakeEvent(), contextWithId, undefined as any);

        expect(onMetrics.mock.calls[0][0]).toMatchObject({ statusCode: 403, outcome: "unauthorized" });
        expect(typeof onMetrics.mock.calls[0][0].authorizeMs).toBe("number");
        expect(onMetrics.mock.calls[0][0].handlerMs).toBeUndefined();
    });

    it("reports an ErrorObject returned by the handler as handler_error", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => new ErrorObject(422, "Bad input"));
        const onMetrics = jest.fn();
        const handler = createApiHandler({ app, authorizeRequest: async () => ({}), onMetrics });

        await handler(fakeEvent(), contextWithId, undefined as any);

        expect(onMetrics.mock.calls[0][0]).toMatchObject({ statusCode: 422, outcome: "handler_error" });
    });

    it("still records handler timing when the handler throws", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => {
            await sleep(30);
            throw new Error("boom");
        });
        const onMetrics = jest.fn();
        const handler = createApiHandler({ app, authorizeRequest: async () => ({}), onMetrics });

        await handler(fakeEvent(), contextWithId, undefined as any);

        const metrics = onMetrics.mock.calls[0][0];
        expect(metrics.outcome).toBe("unhandled_error");
        expect(metrics.statusCode).toBe(500);
        expect(metrics.handlerMs).toBeGreaterThanOrEqual(20);
    });

    it("takes the status code from a custom formatError", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => {
            throw new Error("boom");
        });
        const onMetrics = jest.fn();
        const handler = createApiHandler({
            app,
            authorizeRequest: async () => ({}),
            onMetrics,
            formatError: () => ({ statusCode: 503, body: "unavailable" }),
        });

        await handler(fakeEvent(), contextWithId, undefined as any);

        expect(onMetrics.mock.calls[0][0]).toMatchObject({ statusCode: 503, outcome: "unhandled_error" });
    });

    it("does not let a throwing onMetrics break the response", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => ({ ok: true }));
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        const handler = createApiHandler({
            app,
            authorizeRequest: async () => ({}),
            onMetrics: () => {
                throw new Error("metrics backend down");
            },
        });

        const result = await handler(fakeEvent(), contextWithId, undefined as any);

        expect(result?.statusCode).toBe(200);
        expect(JSON.parse(result!.body)).toEqual({ ok: true });
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it("logs a single tagged JSON line by default", async () => {
        const app = new App();
        app.get("/widgets", { requestMapper: () => ({}) }, async () => ({ ok: true }));
        const consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
        const handler = createApiHandler({ app, authorizeRequest: async () => ({}) });

        await handler(fakeEvent(), contextWithId, undefined as any);

        expect(consoleLog).toHaveBeenCalledTimes(1);
        expect(JSON.parse(consoleLog.mock.calls[0][0] as string)).toMatchObject({
            msg: "api-metrics",
            outcome: "success",
            statusCode: 200,
            requestId: "req-123",
        });
        consoleLog.mockRestore();
    });
});
