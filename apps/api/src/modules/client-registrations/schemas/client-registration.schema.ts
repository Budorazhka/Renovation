import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Фиксация клиента у застройщика: агентство заявляет, что этот покупатель
 * пришёл от него, и на срок закрепления вознаграждение по нему принадлежит
 * агентству. До этого модуля экран «Регистрации» ERP работал на вшитых
 * примерах и localStorage — заявка не уходила никуда и никем не
 * подтверждалась.
 *
 * Решение владельца 16.09.2026: подтверждает застройщик на платформе, срок
 * закрепления — 6 месяцев с момента подтверждения. Для застройщика вне
 * платформы остаётся ручной режим: менеджер сам отмечает «подтверждена»,
 * когда получил ответ по почте.
 *
 * `pending` — заявка подана; `active` — клиент закреплён до `reservedUntil`;
 * `rejected` — застройщик отказал (обычно клиент уже закреплён за другими);
 * `completed` — сделка состоялась; `cancelled` — агентство сняло заявку.
 * Истёкшее закрепление отдельным статусом НЕ хранится: оно выводится из
 * `reservedUntil` на чтении, иначе один и тот же факт отвечал бы дважды и
 * по-разному (тот же принцип, что `isOverdue` у задачи).
 */
export type ClientRegistrationStatus = 'pending' | 'active' | 'rejected' | 'completed' | 'cancelled';

export const CLIENT_REGISTRATION_STATUSES: readonly ClientRegistrationStatus[] = [
  'pending',
  'active',
  'rejected',
  'completed',
  'cancelled',
] as const;

/** Сколько длится закрепление клиента за агентством после подтверждения. */
export const CLIENT_RESERVATION_MONTHS = 6;

@Schema({ collection: 'client_registrations', timestamps: true })
export class ClientRegistrationDocument extends Document {
  declare _id: Types.ObjectId;

  /** Агентство, которое фиксирует клиента. Владелец записи. */
  @Prop({ required: true, type: Types.ObjectId, index: true })
  organizationId!: Types.ObjectId;

  /**
   * Застройщик на платформе. Выводится сервером из ЖК, клиент его не
   * передаёт: иначе агентство могло бы адресовать заявку любой чужой
   * организации. У застройщика вне платформы не задан.
   */
  @Prop({ required: false, type: Types.ObjectId, index: true })
  developerOrganizationId?: Types.ObjectId;

  /** ЖК на платформе; у застройщика вне платформы не задан. */
  @Prop({ required: false, type: Types.ObjectId })
  developmentId?: Types.ObjectId;

  /** Имя застройщика на момент подачи — снимок, чтобы запись читалась и через год. */
  @Prop({ required: true, trim: true, maxlength: 200 })
  developerName!: string;

  /** Название проекта или ЖК на момент подачи. */
  @Prop({ required: true, trim: true, maxlength: 200 })
  projectName!: string;

  /** Лот, корпус, квартира — свободная строка, если клиент смотрит конкретное. */
  @Prop({ required: false, trim: true, maxlength: 200 })
  unitLabel?: string;

  @Prop({ required: true, trim: true, maxlength: 200 })
  clientName!: string;

  @Prop({ required: true, trim: true, maxlength: 40 })
  clientPhone!: string;

  /**
   * Телефон без разделителей — по нему проверяется, не закреплён ли клиент
   * за другим агентством. Хранится отдельно от показываемого номера, чтобы
   * «+995 555 12-34-56» и «995555123456» считались одним человеком.
   */
  @Prop({ required: true, index: true })
  clientPhoneNormalized!: string;

  /** Лид CRM, из которого выросла регистрация; необязателен. */
  @Prop({ required: false, type: Types.ObjectId })
  leadId?: Types.ObjectId;

  /** Позиция менеджера, подавшего заявку. */
  @Prop({ required: true, type: Types.ObjectId, index: true })
  agentPositionId!: Types.ObjectId;

  @Prop({ required: true, enum: CLIENT_REGISTRATION_STATUSES, default: 'pending' })
  status!: ClientRegistrationStatus;

  /** До какого момента клиент закреплён за агентством; заполняется при подтверждении. */
  @Prop({ required: false })
  reservedUntil?: Date;

  /** Когда заявку подтвердили или отклонили. */
  @Prop({ required: false })
  decidedAt?: Date;

  /** Позиция того, кто решил. У ручного подтверждения — менеджер агентства. */
  @Prop({ required: false, type: Types.ObjectId })
  decidedByPositionId?: Types.ObjectId;

  /** Причина отказа застройщика — она нужна агентству, а не только статус. */
  @Prop({ required: false, trim: true, maxlength: 1000 })
  decisionNote?: string;

  @Prop({ required: false, maxlength: 2000 })
  notes?: string;

  /** CAS: каждое решение и правка присылают версию, которую видел отправитель. */
  @Prop({ required: true, default: 0 })
  version!: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ClientRegistrationSchema = SchemaFactory.createForClass(ClientRegistrationDocument);

/** Реестр агентства: свои заявки по статусу, свежие первыми. */
ClientRegistrationSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

/** Входящие застройщика: заявки к его ЖК. */
ClientRegistrationSchema.index({ developerOrganizationId: 1, status: 1, createdAt: -1 });

/** Проверка «клиент уже закреплён»: тот же телефон в том же ЖК. */
ClientRegistrationSchema.index({ developmentId: 1, clientPhoneNormalized: 1, status: 1 });

/** Срок закрепления в часовом поясе сервера считается по этой дате. */
ClientRegistrationSchema.index({ reservedUntil: 1 });
