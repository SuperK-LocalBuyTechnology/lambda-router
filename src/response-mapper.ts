/**
 * Shapes a handler's successful result into what the client actually receives. Handlers
 * can return rich domain objects; the mapper is an allowlist, so a field reaches the
 * client only if the mapper names it. Registered per route via `APIOptions.responseMapper`.
 *
 * May be async (e.g. Zod `parseAsync`); it is awaited.
 *
 * Only successful results are mapped; an `ErrorObject` is returned as is.
 */
export interface ResponseMapper<TResponse, TMapped = unknown, TAuthCtx = unknown> {
    responseMapper: (response: TResponse, authorizerContext: TAuthCtx) => TMapped | Promise<TMapped>;
}
