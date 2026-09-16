import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type DevSelectionStatus = 'draft' | 'sent' | 'viewed' | 'archived';
export type DevSelectionReaction = 'liked' | 'disliked' | 'question';

/**
 * N-27: лот подборки — либо юнит новостройки (`developments`), либо
 * объявление вторичного рынка (`@baza/property-assets`). До этого прохода
 * `unitId` был единственным и обязательным полем — подборки вторички
 * существовали только в браузере агента (`selections-mock`), сервер их не
 * хранил вовсе.
 */
export type DevSelectionTargetType = 'unit' | 'listing';

export interface DevSelectionItem {
  /** `default: 'unit'` — у документов, записанных до N-27, поля не было; Mongoose применяет default и при чтении, старые записи читаются как unit без миграции. */
  targetType: DevSelectionTargetType;
  unitId?: Types.ObjectId;
  listingId?: Types.ObjectId;
  agentNote?: string;
  reaction?: DevSelectionReaction;
  viewedAt?: Date;
}

const DevSelectionItemSchema = new MongooseSchema(
  {
    targetType: { type: String, required: true, enum: ['unit', 'listing'], default: 'unit' },
    unitId: { type: MongooseSchema.Types.ObjectId, required: false },
    listingId: { type: MongooseSchema.Types.ObjectId, required: false },
    agentNote: { type: String, required: false, maxlength: 2000 },
    reaction: { type: String, required: false, enum: ['liked', 'disliked', 'question'] },
    viewedAt: { type: Date, required: false },
  },
  { _id: false },
);

/**
 * Подборки лотов для клиента (dev selections). Живёт вне модулей `developments`
 * и `crm` — ссылается на Unit (developments) и опционально на Lead (crm), но не
 * принадлежит ни одному из них по домену (ADR-001: cross-module связи только
 * через сервисы, см. SelectionsService.requireUnitsExist/requireLeadExists).
 *
 * `publicToken` — НЕ хешируется на диске, в отличие от session/invite токенов
 * (SessionService/OrganizationsService.inviteTeamMember): те токены раскрываются
 * клиенту РОВНО ОДИН РАЗ и затем сверяются только по hash, потому что нет
 * легитимной причины показывать их владельцу повторно. Здесь наоборот — агент
 * открывает карточку подборки многократно (SelectionsDevPage) и должен увидеть
 * и скопировать ту же ссылку снова; односторонний hash сделал бы это невозможным.
 * Секретность обеспечивается исключительно энтропией (32 случайных байта,
 * randomBytes(32).toString('hex') — 256 бит, тот же генератор, что и session/
 * invite токены, см. SelectionsService.generatePublicToken), не хешированием:
 * при утечке самой БД hash не добавил бы защиты (organizationId и так даёт
 * прямой доступ ко всем подборкам организации), а нужно защититься только от
 * угадывания/перебора токена третьей стороной — с 256 битами энтропии это
 * вычислительно невозможно.
 */
@Schema({ collection: 'dev_selections', timestamps: true })
export class DevSelectionDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  createdByPositionId!: Types.ObjectId;

  @Prop({ required: true, unique: true })
  publicToken!: string;

  @Prop({ required: true, maxlength: 200 })
  title!: string;

  @Prop({ type: Types.ObjectId, required: false })
  leadId?: Types.ObjectId;

  @Prop({ required: false, maxlength: 200 })
  clientName?: string;

  @Prop({ required: false, maxlength: 50 })
  clientPhone?: string;

  @Prop({ required: false, maxlength: 2000 })
  agentNote?: string;

  @Prop({ required: true, enum: ['draft', 'sent', 'viewed', 'archived'], default: 'draft' })
  status!: DevSelectionStatus;

  @Prop({ type: [DevSelectionItemSchema], default: [] })
  items!: DevSelectionItem[];

  @Prop({ required: false })
  sentAt?: Date;

  @Prop({ required: false })
  lastOpenedAt?: Date;

  @Prop({ required: true, default: 0 })
  viewCount!: number;

  /** Настройки клиентского отображения (язык, валюта, видимость блоков) — чисто UI-конфиг, без чувствительных данных. */
  @Prop({ type: Object, required: false })
  customization?: Record<string, unknown>;

  /** conventions.md разд.5 — optimistic concurrency (409 VERSION_CONFLICT). */
  @Prop({ required: true, default: 0 })
  version!: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const DevSelectionSchema = SchemaFactory.createForClass(DevSelectionDocument);

DevSelectionSchema.index({ organizationId: 1, createdAt: -1 });
DevSelectionSchema.index({ organizationId: 1, createdByPositionId: 1 });
// publicToken уже unique через @Prop({unique:true}) выше — отдельный index() не нужен.
