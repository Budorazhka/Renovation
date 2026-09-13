import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { BuyerRequestRepository } from './repository/buyer-request.repository';
import type { BuyerRequestDocument, BuyerRequestStatus } from './schemas/buyer-request.schema';
import type { CreateBuyerRequestDto } from './dto/create-buyer-request.dto';

export interface BuyerRequestView {
  id: string;
  dealType: 'buy' | 'rent';
  city: string;
  propertyKind: string;
  title: string;
  comment: string;
  budget: { amount: number; currency: string; perMonth: boolean };
  status: BuyerRequestStatus;
  createdAt: string;
}

function toView(doc: BuyerRequestDocument): BuyerRequestView {
  return {
    id: doc._id.toString(),
    dealType: doc.dealType,
    city: doc.city,
    propertyKind: doc.propertyKind,
    title: doc.title,
    comment: doc.comment,
    budget: { amount: doc.budgetAmount, currency: doc.budgetCurrency, perMonth: doc.budgetPerMonth },
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
  };

}

@Injectable()
export class BuyerRequestsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly repository: BuyerRequestRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  async listPublic(params: Parameters<BuyerRequestRepository['listPublic']>[0]) {
    const docs = await this.repository.listPublic({ ...params, limit: params.limit + 1 });
    const hasMore = docs.length > params.limit;
    const items = (hasMore ? docs.slice(0, params.limit) : docs).map(toView);
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  }

  async listMine(identityId: Types.ObjectId) {
    const docs = await this.repository.listForAuthor(identityId);
    return { items: docs.map(toView) };
  }

  async create(params: { identityId: Types.ObjectId; idempotencyKey: string; data: CreateBuyerRequestDto }) {
    const requestBody = { ...params.data };
    const replay = await this.idempotency.checkReplay({
      identityId: params.identityId,
      operation: 'createBuyerRequest',
      key: params.idempotencyKey,
      requestBody,
    });
    if (replay) return replay.responseBody as unknown as BuyerRequestView;

    return runInTransaction(this.connection, async (session) => {
      const created = await this.repository.create({
        authorIdentityId: params.identityId,
        ...requestBody,
        status: 'published',
      }, session);
      const response = toView(created);
      await this.idempotency.record({
        identityId: params.identityId,
        operation: 'createBuyerRequest',
        key: params.idempotencyKey,
        requestBody,
        responseStatus: 201,
        responseBody: response as unknown as Record<string, unknown>,
      }, session);
      return response;
    });
  }

  /**
   * The CAS in the repository only transitions status:'published' -> 'closed',
   * so a retried request (client timeout, at-least-once resend) that arrives
   * after the first attempt already closed the request would otherwise see a
   * spurious 404 on an operation that already succeeded. Falling back to a
   * plain ownership read on a CAS miss makes a repeat call return the same
   * closed state instead of "not found" — true only if it's still theirs;
   * anyone else's id, or one that was never published, keeps the 404.
   */
  async close(id: Types.ObjectId, identityId: Types.ObjectId) {
    const closed = await this.repository.close(id, identityId);
    if (closed) return toView(closed);

    const existing = await this.repository.findByIdForAuthor(id, identityId);
    if (existing && existing.status === 'closed') return toView(existing);

    throw new NotFoundException('Buyer request not found');
  }
}
