import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  NotificationDeliveryDocument,
  type NotificationChannel,
  type NotificationDeliveryStatus,
  type NotificationKind,
} from '../schemas/notification-delivery.schema';

export interface QueueDeliveryParams {
  kind: NotificationKind;
  refId: Types.ObjectId;
  channel: NotificationChannel;
  identityId: Types.ObjectId;
  address: string;
  subject: string;
  text: string;
}

export type DeliveryCounts = Record<NotificationDeliveryStatus, number>;

export type DeliveryStats = Record<NotificationChannel, DeliveryCounts>;

export function emptyDeliveryStats(): DeliveryStats {
  const counts = (): DeliveryCounts => ({ pending: 0, sent: 0, failed: 0, skipped: 0 });
  return { email: counts(), telegram: counts() };
}

/**
 * Журнал доставок уведомлений. Не tenant-коллекция: доставка адресована
 * человеку (identity), организацию несёт сама новость (refId).
 */
@Injectable()
export class NotificationDeliveryRepository {
  constructor(
    @InjectModel(NotificationDeliveryDocument.name)
    private readonly model: Model<NotificationDeliveryDocument>,
  ) {}

  async queue(deliveries: QueueDeliveryParams[], session?: ClientSession): Promise<number> {
    if (deliveries.length === 0) return 0;
    const created = await this.model.insertMany(
      deliveries.map((delivery) => ({ ...delivery, status: 'pending' })),
      { session, ordered: true },
    );
    return created.length;
  }

  async listPending(kind: NotificationKind, refId: Types.ObjectId, limit: number): Promise<NotificationDeliveryDocument[]> {
    return this.model.find({ kind, refId, status: 'pending' }).sort({ _id: 1 }).limit(limit).exec();
  }

  /** Условный переход из pending: повтор события не перезапишет итог уже обработанной доставки. */
  async markSent(id: Types.ObjectId): Promise<void> {
    await this.model.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'sent', sentAt: new Date() }, $unset: { lastError: '' } }).exec();
  }

  async markFailed(id: Types.ObjectId, error: string): Promise<void> {
    await this.model.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'failed', lastError: error.slice(0, 500) } }).exec();
  }

  async markSkipped(id: Types.ObjectId, reason: string): Promise<void> {
    await this.model.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'skipped', lastError: reason.slice(0, 500) } }).exec();
  }

  /** Сводка по каналам и статусам для списка новостей у того, кто их публикует. */
  async statsByRefIds(kind: NotificationKind, refIds: Types.ObjectId[]): Promise<Map<string, DeliveryStats>> {
    const stats = new Map<string, DeliveryStats>();
    if (refIds.length === 0) return stats;
    const rows = await this.model
      .aggregate<{ _id: { refId: Types.ObjectId; channel: NotificationChannel; status: NotificationDeliveryStatus }; count: number }>([
        { $match: { kind, refId: { $in: refIds } } },
        { $group: { _id: { refId: '$refId', channel: '$channel', status: '$status' }, count: { $sum: 1 } } },
      ])
      .exec();
    for (const row of rows) {
      const key = row._id.refId.toString();
      const entry = stats.get(key) ?? emptyDeliveryStats();
      entry[row._id.channel][row._id.status] = row.count;
      stats.set(key, entry);
    }
    return stats;
  }
}
