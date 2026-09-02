import { APIHandlerMap, APIOptions } from "../src/types";
import { RequestMapper } from "../src/request-mapper";

describe("route table shapes", () => {
    it("composes a RequestMapper, options, and handler into an APIHandlerMap entry", () => {
        const requestMapper: RequestMapper<{ id: string }> = {
            requestMapper: (event) => ({ id: event.pathParameters?.id ?? "" }),
        };
        const options: APIOptions = { authType: "ALLOW_AUTHENTICATED_CLIENTS" };
        const handlerMap: APIHandlerMap = {
            "/widgets/{id}": {
                handler: async (request) => ({ id: request.id }),
                requestMapper,
                options,
            },
        };

        expect(handlerMap["/widgets/{id}"].options.authType).toBe("ALLOW_AUTHENTICATED_CLIENTS");
        expect(
            handlerMap["/widgets/{id}"].requestMapper.requestMapper({ pathParameters: { id: "abc" } } as any)
        ).toEqual({ id: "abc" });
    });
});
