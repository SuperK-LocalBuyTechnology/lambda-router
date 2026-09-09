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

## What this is not (yet)

This release covers the "one real API Gateway resource per route" style shown above. A
second routing mode for services sitting behind a single greedy `{proxy+}` resource is
planned but not included here.

## License

MIT
