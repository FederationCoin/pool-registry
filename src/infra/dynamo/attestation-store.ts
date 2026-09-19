import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { AttestationRecord } from '../../domain/types';
import type { AttestationStore } from '../../ports/attestation-store';

export class DynamoAttestationStore implements AttestationStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client: DynamoDBClient,
  ) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async put(row: AttestationRecord): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: row }));
  }

  async get(attesterWallet: string, poolId: string): Promise<AttestationRecord | undefined> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { attesterWallet, poolId } }),
    );
    return out.Item as AttestationRecord | undefined;
  }

  async listByPool(poolId: string): Promise<AttestationRecord[]> {
    const rows: AttestationRecord[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const out = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: 'PoolId',
          KeyConditionExpression: 'poolId = :p',
          ExpressionAttributeValues: { ':p': poolId },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      rows.push(...((out.Items ?? []) as AttestationRecord[]));
      exclusiveStartKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);
    return rows;
  }
}
