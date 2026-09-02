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
    authorizeRequest: async (event) => {
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

## What this is not (yet)

This release covers the "one real API Gateway resource per route" style shown above. A
second routing mode for services sitting behind a single greedy `{proxy+}` resource is
planned but not included here.

## License

MIT
