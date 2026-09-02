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
});
