import { App, ErrorObject, ResponseSchemaError, createApiHandler, schemaResponseMapper } from "../src/index";

describe("barrel export", () => {
    it("exposes the public API surface", () => {
        expect(typeof App).toBe("function");
        expect(typeof ErrorObject).toBe("function");
        expect(typeof createApiHandler).toBe("function");
        expect(typeof schemaResponseMapper).toBe("function");
        expect(typeof ResponseSchemaError).toBe("function");
    });

    it("App instances have the expected route-registration methods", () => {
        const app = new App();
        expect(typeof app.get).toBe("function");
        expect(typeof app.post).toBe("function");
        expect(typeof app.put).toBe("function");
        expect(typeof app.delete).toBe("function");
        expect(typeof app.getHandler).toBe("function");
    });
});
