// AWS Lambda entry point (Function URL): Nova on Bedrock, state in DynamoDB.
import { createApp } from './app.mjs';
import { respond } from './respond.mjs';
import { config } from './config.mjs';
import { bedrockModel } from './model/bedrock.mjs';
import { dynamoStore } from './store/dynamodb.mjs';

const handle = createApp({
  config,
  store: dynamoStore(process.env.TABLE_NAME),
  model: bedrockModel({ textModelId: process.env.TEXT_MODEL_ID, visionModelId: process.env.VISION_MODEL_ID }),
});

export const handler = async (event) => {
  const raw = event.body ?? '';
  const text = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  const res = await respond(handle, {
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.queryStringParameters ?? {},
    headers: event.headers ?? {},
    body: text ? JSON.parse(text) : {},
  });
  return { statusCode: res.status, headers: res.headers, body: res.body };
};
