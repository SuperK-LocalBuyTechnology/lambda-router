import { ResponseMapper } from "./response-mapper";

/** Any schema with a Zod-style `safeParse`. Zod 3 and Zod 4 schemas both fit, so this package needs no Zod dependency. */
export interface ResponseSchema<T> {
    safeParse(
        value: unknown
    ): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; code: string }[] } };
}

export interface ResponseSchemaIssue {
    path: string;
    code: string;
}

/** Thrown when a handler's result does not match its route's response schema. Always an `Error`, so it becomes a 500. */
export class ResponseSchemaError extends Error {
    readonly schemaName: string;
    readonly issues: ResponseSchemaIssue[];

    constructor(schemaName: string, issues: ResponseSchemaIssue[]) {
        super(`lambda-router: response did not match schema ${schemaName}`);
        this.name = "ResponseSchemaError";
        this.schemaName = schemaName;
        this.issues = issues;
    }
}

/**
 * A `responseMapper` that sends only the fields `schema` declares. On a mismatch it logs the
 * schema name and field paths (never values) and throws, so the client gets the generic 500.
 */
export function schemaResponseMapper<T>(name: string, schema: ResponseSchema<T>): ResponseMapper<unknown, T> {
    return {
        responseMapper: (result) => {
            const parsed = schema.safeParse(result);
            if (parsed.success) {
                return parsed.data;
            }
            const issues = parsed.error.issues.map((issue) => ({
                path: issue.path.map(String).join("."),
                code: issue.code,
            }));
            console.error({ msg: "RESPONSE_SCHEMA_MISMATCH", schema: name, issues });
            throw new ResponseSchemaError(name, issues);
        },
    };
}
