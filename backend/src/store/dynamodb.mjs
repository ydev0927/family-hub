// AWS store: the whole household state as one DynamoDB item, with a version number
// checked on every write so concurrent requests cannot overwrite each other.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ConflictError } from './conflict.mjs';

export function dynamoStore(tableName) {
  if (!tableName) throw new Error('TABLE_NAME must be set');
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const key = { pk: 'household' };
  return {
    async load() {
      const res = await client.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
      if (!res.Item) return null;
      return { state: JSON.parse(res.Item.state), version: res.Item.version ?? 0 };
    },
    async save(state, expectedVersion) {
      const version = expectedVersion + 1;
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: { ...key, version, state: JSON.stringify(state) },
            ConditionExpression: expectedVersion === 0 ? 'attribute_not_exists(pk)' : '#v = :v',
            ...(expectedVersion === 0
              ? {}
              : { ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expectedVersion } }),
          }),
        );
      } catch (e) {
        if (e.name === 'ConditionalCheckFailedException') {
          throw new ConflictError(`expected version ${expectedVersion}`);
        }
        throw e;
      }
      return version;
    },
  };
}
