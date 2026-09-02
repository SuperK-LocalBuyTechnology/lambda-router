import { ErrorObject } from "../src/handler-types";

describe("ErrorObject", () => {
    it("stores statusCode and message", () => {
        const error = new ErrorObject(404, "Not found");
        expect(error.statusCode).toBe(404);
        expect(error.message).toBe("Not found");
    });

    describe("isErrorObject", () => {
        it("returns true for a real ErrorObject instance", () => {
            expect(ErrorObject.isErrorObject(new ErrorObject(500, "boom"))).toBe(true);
        });

        it("returns true for a duck-typed object with statusCode and message", () => {
            expect(ErrorObject.isErrorObject({ statusCode: 400, message: "bad" })).toBe(true);
        });

        it("returns false for null or undefined", () => {
            expect(ErrorObject.isErrorObject(null)).toBe(false);
            expect(ErrorObject.isErrorObject(undefined)).toBe(false);
        });

        it("returns false for primitives", () => {
            expect(ErrorObject.isErrorObject("a string")).toBe(false);
            expect(ErrorObject.isErrorObject(42)).toBe(false);
            expect(ErrorObject.isErrorObject(true)).toBe(false);
        });

        it("returns false for an object missing statusCode or message", () => {
            expect(ErrorObject.isErrorObject({ success: true })).toBe(false);
        });

        it("returns false when statusCode/message have the wrong types", () => {
            expect(ErrorObject.isErrorObject({ statusCode: "shipped", message: "Order placed" })).toBe(false);
        });
    });

    describe("getErrorObjectFromError", () => {
        it("wraps a native Error as a 500", () => {
            const result = ErrorObject.getErrorObjectFromError(new Error("boom"), false);
            expect(result.statusCode).toBe(500);
            expect(result.message).toBe("boom");
        });

        it("preserves statusCode/message from a duck-typed error", () => {
            const result = ErrorObject.getErrorObjectFromError({ statusCode: 403, message: "forbidden" }, false);
            expect(result.statusCode).toBe(403);
            expect(result.message).toBe("forbidden");
        });

        it("falls back to a generic 500 for anything else", () => {
            const result = ErrorObject.getErrorObjectFromError("a weird thrown value", false);
            expect(result.statusCode).toBe(500);
            expect(result.message).toBe("Internal server error.");
        });

        it("falls back to a generic 500 when statusCode/message have the wrong types", () => {
            const result = ErrorObject.getErrorObjectFromError(
                { statusCode: "shipped", message: "Order placed" },
                false
            );
            expect(result.statusCode).toBe(500);
            expect(result.message).toBe("Internal server error.");
        });

        it("falls back to a generic 500 when statusCode or message is missing", () => {
            const result = ErrorObject.getErrorObjectFromError({ statusCode: 403 }, false);
            expect(result.statusCode).toBe(500);
            expect(result.message).toBe("Internal server error.");
        });
    });
});
