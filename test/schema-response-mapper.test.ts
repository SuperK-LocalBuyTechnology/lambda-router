import { APIGatewayProxyEvent, Context } from "aws-lambda";
import { z as z3 } from "zod";
import { z as z4 } from "zod/v4";
import { App } from "../src/app";
import { createApiHandler } from "../src/create-api-handler";
import { ErrorObject } from "../src/handler-types";
import { ResponseSchemaError, schemaResponseMapper } from "../src/schema-response-mapper";

function fakeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
        httpMethod: "GET",
        resource: "/orders",
        path: "/orders",
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

const richOrder = {
    orderId: "o1",
    status: "PLACED",
    internalCost: 42,
    customer: { name: "Asha", phone: "9999999999" },
    items: [{ sku: "s1", quantity: 2, unitCost: 10 }],
};

const trimmedOrder = {
    orderId: "o1",
    status: "PLACED",
    customer: { name: "Asha" },
    items: [{ sku: "s1", quantity: 2 }],
};

const zodVersions = [
    {
        version: "Zod 3",
        schema: z3.object({
            orderId: z3.string(),
            status: z3.string(),
            note: z3.string().optional(),
            customer: z3.object({ name: z3.string() }),
            items: z3.array(z3.object({ sku: z3.string(), quantity: z3.number() })),
        }),
    },
    {
        version: "Zod 4",
        schema: z4.object({
            orderId: z4.string(),
            status: z4.string(),
            note: z4.string().optional(),
            customer: z4.object({ name: z4.string() }),
            items: z4.array(z4.object({ sku: z4.string(), quantity: z4.number() })),
        }),
    },
];

describe.each(zodVersions)("schemaResponseMapper with $version", ({ schema }) => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("keeps only declared keys, including in nested objects and arrays", () => {
        const mapper = schemaResponseMapper("Order", schema);

        expect(mapper.responseMapper(richOrder, undefined)).toEqual(trimmedOrder);
    });

    it("accepts a missing optional field", () => {
        const mapper = schemaResponseMapper("Order", schema);

        expect(mapper.responseMapper(richOrder, undefined)).not.toHaveProperty("note");
    });

    it("on a mismatch logs the schema name and field paths, and throws ResponseSchemaError", () => {
        const mapper = schemaResponseMapper("Order", schema);
        const invalid = { ...richOrder, items: [{ sku: "s1", quantity: "two" }] };

        let thrown: unknown;
        try {
            mapper.responseMapper(invalid, undefined);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(ResponseSchemaError);
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as ResponseSchemaError).schemaName).toBe("Order");
        expect((thrown as ResponseSchemaError).issues).toEqual([{ path: "items.0.quantity", code: "invalid_type" }]);
        expect(consoleErrorSpy).toHaveBeenCalledWith({
            msg: "RESPONSE_SCHEMA_MISMATCH",
            schema: "Order",
            issues: [{ path: "items.0.quantity", code: "invalid_type" }],
        });
    });

    it("never logs field values", () => {
        const mapper = schemaResponseMapper("Order", schema);
        const invalid = { ...richOrder, orderId: 12345 };

        expect(() => mapper.responseMapper(invalid, undefined)).toThrow(ResponseSchemaError);
        expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain("12345");
        expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain("9999999999");
    });
});

describe("schemaResponseMapper through createApiHandler", () => {
    const schema = zodVersions[0].schema;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    function handlerFor(result: unknown) {
        const app = new App();
        app.get("/orders", { requestMapper: () => ({}) }, async () => result, {
            responseMapper: schemaResponseMapper("Order", schema),
        });
        return createApiHandler({ app, authorizeRequest: async () => ({}), onMetrics: () => {} });
    }

    it("returns 200 with only the declared fields", async () => {
        const result = await handlerFor(richOrder)(fakeEvent(), fakeContext, undefined as any);

        expect(result?.statusCode).toBe(200);
        expect(JSON.parse(result!.body)).toEqual(trimmedOrder);
    });

    it("returns the generic 500 on a mismatch, never the unmapped data", async () => {
        const result = await handlerFor({ ...richOrder, orderId: undefined })(
            fakeEvent(),
            fakeContext,
            undefined as any
        );

        expect(result?.statusCode).toBe(500);
        expect(result!.body).not.toContain("internalCost");
        expect(result!.body).not.toContain("9999999999");
    });

    it("does not run the schema when the handler returns an ErrorObject", async () => {
        const result = await handlerFor(new ErrorObject(400, "Bad request"))(
            fakeEvent(),
            fakeContext,
            undefined as any
        );

        expect(result?.statusCode).toBe(400);
        expect(JSON.parse(result!.body)).toEqual({ message: "Bad request" });
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.objectContaining({ msg: "RESPONSE_SCHEMA_MISMATCH" }));
    });
});
