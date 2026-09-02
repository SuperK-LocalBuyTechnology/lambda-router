import { Context } from "aws-lambda";

export class ErrorObject {
    statusCode: number;
    message: string;

    constructor(statusCode: number, message: string) {
        this.statusCode = statusCode;
        this.message = message;
    }

    static isErrorObject(value: unknown): value is ErrorObject {
        if (value === null || value === undefined) {
            return false;
        }
        if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
            return false;
        }
        return (
            value instanceof ErrorObject ||
            (typeof (value as { statusCode?: unknown }).statusCode === "number" &&
                typeof (value as { message?: unknown }).message === "string")
        );
    }

    static getErrorObjectFromError(error: unknown, logError: boolean = true): ErrorObject {
        if (logError) {
            console.error("ErrorObject.getErrorObjectFromError: returning because of an error", error);
        }
        if (error instanceof Error) {
            return new ErrorObject(500, error.message);
        }
        if (
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            "message" in error &&
            typeof error.statusCode == "number" &&
            typeof error.message == "string"
        ) {
            return new ErrorObject(
                (error as { statusCode: number }).statusCode,
                (error as { message: string }).message
            );
        }
        return new ErrorObject(500, "Internal server error.");
    }
}

export type Handler<TRequest, TResponse, TAuthCtx = unknown> = (
    event: TRequest,
    authorizerContext: TAuthCtx,
    context: Context
) => Promise<TResponse | ErrorObject>;
