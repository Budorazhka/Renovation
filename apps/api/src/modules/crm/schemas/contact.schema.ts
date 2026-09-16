import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export const CONTACT_ROLES = ['buyer', 'investor', 'owner', 'referral', 'broker'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/**
 * Куда контакт сейчас относится — не хранится, считается сервером из
 * стадий его сделок и лидов (CrmService.buildContactSegmentIndex, N-20):
 * `golden` — дошёл до золотого фонда (сделка в стадии golden/check_in/
 * referral); `active` — сделка или лид ещё в работе, либо контакт совсем
 * свежий (ни одной сделки/лида); `archived` — всё, что было, сорвалось
 * (closed_lost сделка или lost лид, без активных); `deferred` — переходный
 * случай без явного сигнала (например, лид конвертирован, а сделки ещё
 * нет).
 */
export const CONTACT_SEGMENTS = ['golden', 'active', 'archived', 'deferred'] as const;
export type ContactSegment = (typeof CONTACT_SEGMENTS)[number];

/**
 * docs/architecture/domain-model.md Модуль 7 / mongodb-schema.md `contacts`.
 * Invariant: tenant-local dedupe по phone — ТОЛЬКО внутри организации,
 * cross-tenant существование не раскрывается (owner decision, master
 * plan: "Дубль лида ищется только внутри одной организации").
 */
@Schema({ collection: 'contacts', timestamps: { createdAt: 'createdAt', updatedAt: false } })
export class ContactDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  phone!: string;

  @Prop()
  email?: string;

  @Prop({ type: [String], default: [] })
  roles!: ContactRole[];

  declare createdAt: Date;
}

export const ContactSchema = SchemaFactory.createForClass(ContactDocument);

ContactSchema.index({ organizationId: 1, phone: 1 });
