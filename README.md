# @superk-in/lambda-router

A small, typed routing framework for AWS Lambda functions sitting behind API Gateway.

## Why

API Gateway's Lambda-proxy integration hands your function a raw
`APIGatewayProxyEvent`. This library gives you a typed route table (`App`), typed
request/response contracts (`Handler`, `RequestMapper`), a uniform error shape
(`ErrorObject`), and a single dispatcher (`createApiHandler`) that wires them together —
with your own authorization logic injected, not hardcoded.

## Install

```bash
npm install @superk-in/lambda-router
```

## Usage

```ts
import { App, createApiHandler, ErrorObject, RequestMapper, Handler } from "@superk-in/lambda-router";
import { APIGatewayProxyEvent } from "aws-lambda";

interface GetWidgetRequest {
    widgetId: string;
}

interface Widget {
    widgetId: string;
    name: string;
}

class GetWidgetMapper implements RequestMapper<GetWidgetRequest> {
    requestMapper(event: APIGatewayProxyEvent): GetWidgetRequest {
        return { widgetId: event.pathParameters!.widgetId! };
    }
}

interface AuthContext {
    userId: string;
}

const getWidgetHandler: Handler<GetWidgetRequest, Widget, AuthContext> = async (request) => {
    if (request.widgetId === "missing") {
        return new ErrorObject(404, "Widget not found");
    }
    return { widgetId: request.widgetId, name: "Example Widget" };
};

const app = new App();
app.get("/widgets/{widgetId}", new GetWidgetMapper(), getWidgetHandler);

export const apiHandler = createApiHandler<AuthContext>({
    app,
    authorizeRequest: async (event, options) => {
        if (options.authType === "ALLOW_UNAUTHENTICATED") {
            return { userId: "anonymous" };
        }

        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return new ErrorObject(401, "Unauthorized");
        }
        return { userId };
    },
});
```

Wire `apiHandler` up as your Lambda's handler, and configure API Gateway with one real
resource per route (e.g. `/widgets/{widgetId}`) using a Lambda-proxy integration —
`App.getHandler` matches on the API Gateway *resource template* (`event.resource`), so
each registered path needs its own backing resource.

`createApiHandler` also accepts three optional hooks: `logEvent`, called with the raw
incoming event before anything else runs, and `formatError`, which controls how an
unrecognized thrown value is turned into a response (it defaults to a generic 500). A
handler may either `return` an `ErrorObject` or `throw` one — both produce the same
formatted error response (the thrown-`ErrorObject` case is honored before `formatError`
ever runs), while any other thrown value is passed to `formatError`.

## Request metrics

Every request emits one `RequestMetrics` record, on every path — including 404s, rejected
authorization, and thrown errors. By default it is written as a single tagged JSON line:

```json
{"msg":"api-metrics","method":"GET","resource":"/widgets/{widgetId}","statusCode":200,"outcome":"success","authorizeMs":12,"handlerMs":84,"totalMs":97,"requestId":"..."}
```

One line of JSON rather than several of free text means CloudWatch Logs Insights can query
it directly:

```
fields resource, handlerMs
| filter msg = "api-metrics"
| stats avg(handlerMs), max(handlerMs), count(*) by resource, outcome
```

`outcome` is one of `success`, `not_found`, `unauthorized`, `handler_error`, or
`unhandled_error`, so slow handlers, unauthorized clients and genuine faults stay
distinguishable in a single query. `authorizeMs` and `handlerMs` are recorded even when
that phase throws — a failing call's duration is usually the one you most want.

Pass `onMetrics` to send the record somewhere else, or to enrich it:

```ts
export const apiHandler = createApiHandler<AuthContext>({
    app,
    authorizeRequest,
    onMetrics: (metrics) => console.log(JSON.stringify({ msg: "api-metrics", ...metrics, cache: cache.getStats() })),
});
```

Throwing from `onMetrics` is caught and logged rather than propagated: instrumentation
must never turn a 200 into a 500.

## Proxy routing

The `App` above dispatches on `event.resource`, which requires one real API Gateway
resource per route. For a service sitting behind a single greedy resource — say
`/plugin/<team-id>/{proxy+}`, so a team can add endpoints without ever touching the
Gateway again — `event.resource` is the same string for every request and cannot be used
to dispatch at all.

`ProxyApp` and `createProxyApiHandler` cover that case. They are separate from
`App`/`createApiHandler` rather than a mode on them, so nothing about the resource-routing
path changes, and a service that never imports them does not pay for them.

Registration is identical, including the same `{param}` convention:

```ts
import { ProxyApp, createProxyApiHandler } from "@superk-in/lambda-router";

const app = new ProxyApp();
app.get("/orders/{orderId}", new GetOrderMapper(), getOrder);
app.post("/orders", new NewOrderMapper(), createOrder);

export const apiHandler = createProxyApiHandler<AuthContext>({ app, authorizeRequest });
```

Matching uses [`path-to-regexp`](https://github.com/pillarjs/path-to-regexp), pinned as a
direct dependency so an unrelated upgrade elsewhere can never silently change how every
route matches.

**Routes cannot overlap.** `path-to-regexp` has no literal-beats-parameter precedence, so
`/orders/{orderId}` would match `/orders/new` perfectly happily and the winner would come
down to which line appears first in a registry file. Rather than depend on that,
registering a route that could match the same request as an existing one throws:

```ts
app.get("/orders/{orderId}", mapper, getOrder);
app.get("/orders/new", mapper, createOrder);
// Error: lambda-router: cannot register GET /orders/new — it overlaps
// GET /orders/{orderId}, which is already registered. A request can match both, so which
// one handles it would depend on the order these were registered in. Give them paths
// that cannot match the same request.
```

This is stricter than API Gateway, which allows that pair and prefers the literal. Two
routes overlap only when they have the same number of segments and no position holds two
different literals, so `/orders/new` and `/orders/draft` are fine, and so are
`/orders/{orderId}/items` and `/orders/new/history`. The check is per method: the same
path under a different verb is unaffected. Matching is therefore order-independent.

### Route syntax

A route is literal segments plus `{name}` parameters, each matching exactly one path
segment. Anything else is rejected **at registration** with a message naming the route you
wrote and what to write instead:

```ts
app.get("/files/{path+}", mapper, handler);
// Error: lambda-router: cannot register GET /files/{path+}. "{path+}" is not supported —
// the +, * and ? modifiers do not exist in this router. Write "{path}" to match exactly
// one path segment.

app.get("/orders/:orderId", mapper, handler);
// Error: ... Routes use {name}, not :orderId — write "/orders/{orderId}".
```

`{proxy+}` is the spelling API Gateway itself uses, so it is an easy thing to reach for;
it is rejected rather than quietly mis-parsed. Wildcards and raw `path-to-regexp` syntax
are rejected for the same reason — routes register when the module loads, so a route the
router cannot honour would otherwise take the Lambda down at cold start and 502 every
request.

The match path comes from `event.pathParameters.proxy` — the remainder API Gateway's
`{proxy+}` integration already provides — never from stripping a prefix off `event.path`,
which is fragile against stage names, base-path mappings and encoding. Captured
parameters are merged into `pathParameters` before the request mapper runs, so mappers
read `event.pathParameters!.orderId` exactly as they do under resource routing. The team
id is a literal segment of that team's own registered resource rather than a path
parameter, so `proxy` is normally all the Gateway supplies; extracted parameters are
merged over it rather than replacing it.

Metrics work the same way, with one deliberate detail: `resource` carries the **registered
route** (`/orders/{orderId}/receipt`), not the concrete path. Reporting the concrete path
would put every order id on its own series and make `stats by resource` useless.

## What this is not (yet)

The dispatchers read AWS API Gateway proxy events directly. Supporting another runtime
would mean factoring out the small "pull `{method, path}` out of the raw event" step
behind an adapter. That is a deliberate extension point, not built here — the need today
is AWS Lambda only.

## License

MIT
