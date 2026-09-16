import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { MoneyAmount } from '@baza/contracts';
import { CuratorAccrualDocument, type CuratorAccrualStatus } from '../schemas/curator-accrual.schema';

/** Итог по куратору в одной валюте и одном статусе. */
export interface CuratorAccrualTotal {
  curatorIdentityId: Types.ObjectId;
  status: CuratorAccrualStatus;
  currency: string;
  amountMinorUnits: number;
  count: number;
}

/** Начисления кураторам. Не tenant-репозиторий: должник — BAZA, получатель — человек (tenant-scope.test.ts). */
@Injectable()
export class CuratorAccrualRepository {
  constructor(
    @InjectModel(CuratorAccrualDocument.name)
    private readonly model: Model<CuratorAccrualDocument>,
  ) {}

  async create(
    params: {
      curatorIdentityId: Types.ObjectId;
      memberIdentityId: Types.ObjectId;
      dealId: Types.ObjectId;
      dealOrganizationId: Types.ObjectId;
      commission: MoneyAmount;
      ratePercent: number;
      amount: MoneyAmount;
    },
    session: ClientSession,
  ): Promise<CuratorAccrualDocument> {
    const [created] = await this.model.create(
      [{ ...params, status: 'accrued', accruedAt: new Date() }],
      { session },
    );
    return created!;
  }

  /** Действующее начисление сделки: `accrued` или `paid`. */
  async findLiveByDeal(dealId: Types.ObjectId, session?: ClientSession): Promise<CuratorAccrualDocument | null> {
    return this.model.findOne({ dealId, status: { $in: ['accrued', 'paid'] } }, null, { session }).exec();
  }

  async listLiveByDeals(dealIds: Types.ObjectId[]): Promise<CuratorAccrualDocument[]> {
    if (dealIds.length === 0) return [];
    return this.model.find({ dealId: { $in: dealIds }, status: { $in: ['accrued', 'paid'] } }).exec();
  }

  async listByCurator(curatorIdentityId: Types.ObjectId, limit: number): Promise<CuratorAccrualDocument[]> {
    return this.model.find({ curatorIdentityId }).sort({ accruedAt: -1 }).limit(limit).exec();
  }

  async listByMember(memberIdentityId: Types.ObjectId, limit: number): Promise<CuratorAccrualDocument[]> {
    return this.model.find({ memberIdentityId }).sort({ accruedAt: -1 }).limit(limit).exec();
  }

  /** Сторно начисления сделки. `allowPaid` — только суперадмину: выплаченное иначе не отменяется. */
  async reverseLiveByDeal(
    dealId: Types.ObjectId,
    params: { reversedByAdminId: Types.ObjectId; reverseReason: string; allowPaid: boolean },
    session: ClientSession,
  ): Promise<CuratorAccrualDocument | null> {
    const statuses = params.allowPaid ? ['accrued', 'paid'] : ['accrued'];
    return this.model
      .findOneAndUpdate(
        { dealId, status: { $in: statuses } },
        {
          $set: {
            status: 'reversed',
            reversedAt: new Date(),
            reversedByAdminId: params.reversedByAdminId,
            reverseReason: params.reverseReason,
          },
        },
        { new: true, session },
      )
      .exec();
  }

  /** Отметить выплату. Только `accrued` этого куратора — чужие и уже выплаченные не трогаются. */
  async markPaid(
    curatorIdentityId: Types.ObjectId,
    accrualIds: Types.ObjectId[],
    params: { paidByAdminId: Types.ObjectId; paidAt: Date },
    session: ClientSession,
  ): Promise<number> {
    const result = await this.model
      .updateMany(
        { _id: { $in: accrualIds }, curatorIdentityId, status: 'accrued' },
        { $set: { status: 'paid', paidAt: params.paidAt, paidByAdminId: params.paidByAdminId } },
        { session },
      )
      .exec();
    return result.modifiedCount;
  }

  /** Итоги по кураторам: сумма и количество по статусу и валюте. */
  async totalsByCurators(curatorIdentityIds: Types.ObjectId[]): Promise<CuratorAccrualTotal[]> {
    if (curatorIdentityIds.length === 0) return [];
    const rows = await this.model
      .aggregate<{
        _id: { curatorIdentityId: Types.ObjectId; status: CuratorAccrualStatus; currency: string };
        amountMinorUnits: number;
        count: number;
      }>([
        { $match: { curatorIdentityId: { $in: curatorIdentityIds } } },
        {
          $group: {
            _id: { curatorIdentityId: '$curatorIdentityId', status: '$status', currency: '$amount.currency' },
            amountMinorUnits: { $sum: '$amount.amountMinorUnits' },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();
    return rows.map((row) => ({
      curatorIdentityId: row._id.curatorIdentityId,
      status: row._id.status,
      currency: row._id.currency,
      amountMinorUnits: row.amountMinorUnits,
      count: row.count,
    }));
  }
}
