import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ReviewRecord } from '../../domain/types';
import type { ReviewStore } from '../../ports/review-store';

export class DynamoReviewStore implements ReviewStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client: DynamoDBClient,
  ) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async put(row: ReviewRecord): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: row }));
  }

  async get(reviewerWallet: string, poolId: string): Promise<ReviewRecord | undefined> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { reviewerWallet, poolId } }),
    );
    return out.Item as ReviewRecord | undefined;
  }

  async listByPool(poolId: string): Promise<ReviewRecord[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'PoolId',
        KeyConditionExpression: 'poolId = :p',
        ExpressionAttributeValues: { ':p': poolId },
      }),
    );
    return (out.Items ?? []) as ReviewRecord[];
  }
}
