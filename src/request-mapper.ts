import { APIGatewayProxyEvent } from "aws-lambda";

export interface RequestMapper<TRequest> {
    requestMapper: (event: APIGatewayProxyEvent) => TRequest;
}
