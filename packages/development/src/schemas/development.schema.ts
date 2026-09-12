import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import type { Currency } from '@baza/contracts';

export type DevelopmentStatus = 'draft' | 'active' | 'archived';

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat] — ADR-007 жёсткое требование порядка
}

export interface DevelopmentLocation {
  country: string;
  city: string;
  address?: string;
  geo: GeoPoint;
}

export interface DevelopmentContact {
  phone: string;
  whatsapp?: string;
  telegram?: string;
}

/**
 * Явный new MongooseSchema(...), не inline plain-object — GeoJSON-стандарт
 * требует именно поле `type` (не переименовать), которое при inline-
 * объявлении конфликтует с зарезервированным SchemaTypeOptions.type и
 * ломает reflection с `Invalid schema configuration: 'true' is not a valid
 * type at path 'required'` (тот же паттерн, что AuditActorSchema/
 * OwnerScopeSchema — известная Mongoose-ловушка, найдена смок-тестом).
 */
const GeoPointSchema = new MongooseSchema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

const LocationSchema = new MongooseSchema(
  {
    country: { type: String, required: true },
    city: { type: String, required: true },
    address: { type: String, required: false },
    geo: { type: GeoPointSchema, required: true },
  },
  { _id: false },
);

/**
 * D-05 owner decision (25.08.2026, зафиксировано в domain-model.md Модуль 4
 * "contact добавлено 25.08.2026"): контакт для reveal-contact указывается
 * НА Development застройщиком при создании ЖК, не на Organization. phone
 * обязателен (единственный гарантированный канал), whatsapp/telegram
 * опциональны.
 */
const ContactSchema = new MongooseSchema(
  {
    phone: { type: String, required: true },
    whatsapp: { type: String, required: false },
    telegram: { type: String, required: false },
  },
  { _id: false },
);

/**
 * docs/architecture/domain-model.md Модуль 4 / mongodb-schema.md `developments`.
 * D-01: draft (редактируется, не публичен) → active (публикуется, ADR-005) → archived.
 *
 * Живёт в @baza/development (не в apps/api) — D-03: worker-процесс
 * (PublicationRequestedHandler) читает Development напрямую для сборки
 * whitelist-проекции MarketplacePublication (ADR-005 explicit mapper),
 * API-процесс пишет/читает её же для CRUD — тот же принцип, что уже
 * применён к outbox_events/media_assets/marketplace_publications.
 * Building/Section/Floor/FloorPlan/Unit остаются в apps/api — worker пока
 * не нуждается в их данных напрямую (mapper для sourceType:'development'
 * использует только верхнеуровневые Development-поля).
 */
@Schema({ collection: 'developments', timestamps: { createdAt: 'createdAt', updatedAt: false } })
export class DevelopmentDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, enum: ['draft', 'active', 'archived'], default: 'draft' })
  status!: DevelopmentStatus;

  @Prop({ type: LocationSchema, required: true })
  location!: DevelopmentLocation;

  @Prop()
  classType?: string;

  @Prop()
  startDate?: Date;

  @Prop()
  completionDate?: Date;

  @Prop()
  description?: string;

  @Prop({ type: ContactSchema, required: true })
  contact!: DevelopmentContact;

  /**
   * Владелец 11.09.2026: одна валюта на весь ЖК. Хранится здесь (а не
   * только выводится из юнитов), потому что это единственное место, на
   * котором два конкурентных createUnit/updateUnitPrice с разными
   * валютами могут атомарно "столкнуться" — CAS через findOneAndUpdate на
   * этом документе внутри транзакции, тот же принцип, что BookingLock
   * (apps/api/src/modules/bookings/schemas/booking-lock.schema.ts):
   * MongoDB детектирует write conflict на общем документе и повторяет
   * проигравшую транзакцию (withTransaction retry), проигравший увидит
   * уже установленную валюту вместо того, чтобы оба одновременно прочли
   * "валюты ещё нет" по отдельным unit-документам, которые друг с другом
   * не конфликтуют. Не задаётся при создании ЖК — ставится первым
   * createUnit/updateUnitPrice, поэтому optional.
   */
  @Prop({ required: false, type: String })
  currency?: Currency;

  /**
   * conventions.md разд.5 — optimistic concurrency. Инкрементируется при
   * каждом update; клиент передаёт ожидаемую version, конфликт → 409
   * VERSION_CONFLICT (D-01 test requirement: "optimistic conflict").
   */
  @Prop({ required: true, default: 0 })
  version!: number;

  /**
   * `[development-legacy-migration]`: id ЖК (Estate) в старой системе —
   * ключ идемпотентности для будущего одноразового скрипта переноса, тот
   * же принцип, что lead.schema.ts::legacyId. Опционально — только у
   * мигрированных ЖК оно есть, обычное создание Development через ERP его
   * никогда не заполняет.
   *
   * Индекс ниже — `partialFilterExpression`, НЕ `sparse:true`, по той же
   * причине, что задокументирована в lead.schema.ts: составной `sparse`
   * индекс на `{organizationId, legacyId}` индексировал бы КАЖДЫЙ
   * Development организации (organizationId присутствует всегда) с
   * `legacyId: null`, и второй немигрированный Development той же
   * организации падал бы на E11000. `partialFilterExpression:
   * {legacyId: {$exists: true}}` индексирует только документы, где поле
   * реально установлено.
   */
  @Prop({ required: false })
  legacyId?: string;

  declare createdAt: Date;
}

export const DevelopmentSchema = SchemaFactory.createForClass(DevelopmentDocument);

DevelopmentSchema.index({ organizationId: 1, status: 1 });
DevelopmentSchema.index({ 'location.geo': '2dsphere' });
DevelopmentSchema.index({ 'location.city': 1, status: 1 });
DevelopmentSchema.index(
  { organizationId: 1, legacyId: 1 },
  { unique: true, partialFilterExpression: { legacyId: { $exists: true } } },
);
