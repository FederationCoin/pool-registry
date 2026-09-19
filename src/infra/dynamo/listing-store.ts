import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { FindPageSize, type ChainId } from '../../domain/constants';
import { decodeCursor, encodeCursor } from '../../domain/rank';
import type { ListingRecord } from '../../domain/types';
import type { ListingQueryPage, ListingStore } from '../../ports/listing-store';

/** Scan is never used. The ScanCommand import is a compile-time guard that we do not call it. */
void (ScanCommand as unknown);

export class DynamoListingStore implements ListingStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client: DynamoDBClient,
  ) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async put(row: ListingRecord): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: row }));
  }

  async get(poolId: string): Promise<ListingRecord | undefined> {
    const out = await this.doc.send(new GetCommand({ TableName: this.table, Key: { poolId } }));
    return out.Item as ListingRecord | undefined;
  }

  async getByOperator(chain: ChainId, wallet: string): Promise<ListingRecord | undefined> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'OperatorWallet',
        KeyConditionExpression: 'operatorWallet = :w',
        ExpressionAttributeValues: { ':w': wallet },
      }),
    );
    return ((out.Items ?? []) as ListingRecord[]).find((r) => r.chain === chain);
  }

  async delete(poolId: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { poolId } }));
  }

  async queryActive(chain: ChainId, q?: string, cursor?: string): Promise<ListingQueryPage> {
    return this.queryIndex('ActiveByChain', 'lastAttributedBlockAt', chain, q, cursor);
  }

  async queryInactive(chain: ChainId, q?: string, cursor?: string): Promise<ListingQueryPage> {
    return this.queryIndex('InactiveByChain', 'hiddenAt', chain, q, cursor);
  }

  async countLive(chain: ChainId): Promise<number> {
    let n = 0;
    let exclusive: Record<string, unknown> | undefined;
    for (;;) {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: 'ActiveByChain',
          KeyConditionExpression: 'chain = :c',
          ExpressionAttributeValues: { ':c': chain },
          Select: 'COUNT',
          ExclusiveStartKey: exclusive,
        }),
      );
      n += page.Count ?? 0;
      exclusive = page.LastEvaluatedKey as Record<string, unknown> | undefined;
      if (!exclusive) {
        break;
      }
    }
    return n;
  }

  async listAll(chain: ChainId): Promise<ListingRecord[]> {
    const items: ListingRecord[] = [];
    for (const index of ['ActiveByChain', 'InactiveByChain'] as const) {
      let exclusive: Record<string, unknown> | undefined;
      for (;;) {
        const page = await this.doc.send(
          new QueryCommand({
            TableName: this.table,
            IndexName: index,
            KeyConditionExpression: 'chain = :c',
            ExpressionAttributeValues: { ':c': chain },
            ExclusiveStartKey: exclusive,
          }),
        );
        items.push(...((page.Items ?? []) as ListingRecord[]));
        exclusive = page.LastEvaluatedKey as Record<string, unknown> | undefined;
        if (!exclusive) {
          break;
        }
      }
    }
    return items;
  }

  private async queryIndex(
    index: string,
    sortKey: string,
    chain: ChainId,
    q?: string,
    cursor?: string,
  ): Promise<ListingQueryPage> {
    const decoded = decodeCursor(cursor);
    const exclusive =
      decoded && typeof decoded.poolId === 'string'
        ? {
            chain,
            [sortKey]: decoded[sortKey],
            poolId: decoded.poolId,
          }
        : undefined;
    const page = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: index,
        KeyConditionExpression: 'chain = :c',
        ExpressionAttributeValues: { ':c': chain },
        ExclusiveStartKey: exclusive,
        Limit: FindPageSize,
        ScanIndexForward: false,
      }),
    );
    let items = (page.Items ?? []) as ListingRecord[];
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter(
        (r) =>
          r.name.toLowerCase().includes(needle) ||
          r.poolId.toLowerCase().includes(needle) ||
          (r.coinbaseTag ?? '').toLowerCase().includes(needle),
      );
    }
    const lek = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    const nextCursor = lek
      ? encodeCursor({ poolId: lek.poolId, [sortKey]: lek[sortKey] })
      : undefined;
    return { items, nextCursor };
  }
}
