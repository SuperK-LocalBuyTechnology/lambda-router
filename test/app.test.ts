import { App } from "../src/app";

describe("App", () => {
    const requestMapper = { requestMapper: (event: any) => event };
    const handler = async () => ({ ok: true });

    it("registers and looks up a GET route", () => {
        const app = new App();
        app.get("/widgets", requestMapper, handler);
        const matched = app.getHandler("GET", "/widgets");
        expect(matched?.handler).toBe(handler);
        expect(matched?.requestMapper).toBe(requestMapper);
    });

    it("applies the default options when none are passed", () => {
        const app = new App();
        app.get("/widgets", requestMapper, handler);
        expect(app.getHandler("GET", "/widgets")?.options).toEqual({ authType: "ALLOW_AUTHENTICATED_CLIENTS" });
    });

    it("honors explicitly passed options", () => {
        const app = new App();
        app.get("/widgets", requestMapper, handler, { authType: "ALLOW_UNAUTHENTICATED" });
        expect(app.getHandler("GET", "/widgets")?.options.authType).toBe("ALLOW_UNAUTHENTICATED");
    });

    it("keeps GET and DELETE on the same path independent", () => {
        const app = new App();
        const deleteHandler = async () => ({ deleted: true });
        app.get("/widgets/{id}", requestMapper, handler);
        app.delete("/widgets/{id}", requestMapper, deleteHandler);
        expect(app.getHandler("GET", "/widgets/{id}")?.handler).toBe(handler);
        expect(app.getHandler("DELETE", "/widgets/{id}")?.handler).toBe(deleteHandler);
    });

    it("returns undefined for an unregistered method/path", () => {
        const app = new App();
        app.get("/widgets", requestMapper, handler);
        expect(app.getHandler("POST", "/widgets")).toBeUndefined();
        expect(app.getHandler("GET", "/unknown")).toBeUndefined();
    });

    it("dispatches getHandler by method case-insensitively", () => {
        const app = new App();
        app.post("/widgets", requestMapper, handler);
        expect(app.getHandler("post", "/widgets")?.handler).toBe(handler);
    });
});
