import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { ALL_LEAD_STAGE_VALUES, REALTOR_STAGE_VALUES, CURATOR_STAGE_VALUES } from '../lead-stage';
import { PRODUCT_TYPES } from '../lead-stage-definitions';

/**
 * Буквальный union literal, НЕ `(typeof LEAD_STAGES)[number]` — найдено
 * смок-тестом: TypeScript emitDecoratorMetadata эмитит design:type как
 * String корректно ТОЛЬКО для буквального union из строковых литералов
 * в объявлении типа, не для производного indexed-access типа через
 * typeof массива, даже если он локально объявлен и структурно эквивалентен
 * (это не то же самое ограничение, что "импортированный union" — более
 * узкое: сама ФОРМА объявления типа имеет значение для reflection, не
 * только его происхождение из другого файла). LEAD_STAGES (runtime-массив
 * из lead-stage.ts) остаётся источником истины для @Prop({enum:...})
 * runtime-валидации — это значение, не TypeScript-тип, decorator metadata
 * reflection его не касается.
 */
export type GenericLeadStage = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';

/**
 * `[technical decision — 03.09.2026]`, продуктовые воронки лида: полный
 * список per-product stage id (см. lead-stage-definitions.ts докстринг —
 * источник этих значений: leads-mock.ts/types.ts/crm-poker-adapter.ts из
 * apps/erp-web, ничего не изобретено). Тот же буквальный union literal
 * приём, что GenericLeadStage выше — не производный тип от
 * LEAD_STAGE_DEFINITIONS (design:type reflection).
 */
export type ProductLeadStage =
  | 'defective' | 'refused' | 'no_answer_3' | 'no_answer_2' | 'no_answer_1'
  | 'callback' | 'presented' | 'country_discussed' | 'need_identified' | 'need_adjusted'
  | 'kp_sent' | 'objections' | 'deferred' | 'warmup' | 'showing' | 'deposit' | 'deal'
  | 'golden' | 'check_in' | 'referral' | 'new_deals'
  | 'network_rejected_defective' | 'network_rejected' | 'network_no_call_3' | 'network_no_call_2' | 'network_no_call_1'
  | 'network_new_lead' | 'network_call_later' | 'network_company_presented' | 'network_platform_presented'
  | 'network_offer_given' | 'network_objections' | 'network_deferred_demand' | 'network_agreement'
  | 'network_form_filled' | 'network_account_registered' | 'network_offer_signed' | 'network_work_started'
  | 'owner_rejected_defective' | 'owner_rejected_owner' | 'owner_no_call_3' | 'owner_no_call_2' | 'owner_no_call_1'
  | 'owner_new_owner' | 'owner_call_later' | 'owner_company_presented' | 'owner_object_discussed'
  | 'owner_photo_proposed' | 'owner_exclusive_proposed' | 'owner_objections' | 'owner_agreed'
  | 'owner_active_for_sale' | 'owner_get_referral' | 'owner_new_object_inquiry'
  | 'agent_rejected_defective' | 'agent_rejected' | 'agent_no_call_3' | 'agent_no_call_2' | 'agent_no_call_1'
  | 'agent_new_agent' | 'agent_call_later' | 'agent_company_presented' | 'agent_format'
  | 'agent_objections' | 'agent_agreed' | 'agent_active';

/** Значение lead.stage — либо одна из 5 generic-стадий (productType не задан), либо одна из per-product стадий (productType задан). */
export type LeadStage = GenericLeadStage | ProductLeadStage;

/** `realtorStage`/`curatorStage` — своя 6-шаговая номенклатура, см. докстринг у @Prop ниже. Локальный литерал по той же причине, что LeadStage (emitDecoratorMetadata). */
export type RealtorStage = 'realtor_1' | 'realtor_2' | 'realtor_3' | 'realtor_4' | 'realtor_5' | 'realtor_6';
export type CuratorStage = 'curator_1' | 'curator_2' | 'curator_3' | 'curator_4' | 'curator_5' | 'curator_6';

/**
 * Тот же буквальный union literal приём, что LeadStage выше — НЕ
 * `import type { ProductType } from '../lead-stage-definitions'` в поле
 * @Prop(): design:type reflection ломается именно на импортированных union
 * в декорированной позиции (см. докстринг GenericLeadStage). Значения
 * буквально совпадают с PRODUCT_TYPES (runtime-массив, источник истины
 * для @Prop({enum:...})) — синхронизировать вручную при изменении списка
 * продуктов, ровно тот же контракт, что LEAD_STAGES/LeadStage сегодня.
 */
export type LeadProductType = 'sales' | 'network' | 'owner' | 'agent';

export interface LeadSource {
  route: string;
  publicationId?: Types.ObjectId;
  utm?: Record<string, string>;
  referrer?: string;
}

const LeadSourceSchema = new MongooseSchema(
  {
    route: { type: String, required: true },
    publicationId: { type: MongooseSchema.Types.ObjectId, required: false },
    utm: { type: Object, required: false },
    referrer: { type: String, required: false },
  },
  { _id: false },
);

/**
 * docs/architecture/domain-model.md Модуль 7 / mongodb-schema.md `leads`.
 * stage — денормализованное текущее значение для быстрого чтения; история
 * переходов — отдельная append-only коллекция LeadEvent, НЕ embedded массив
 * здесь (не раздувать документ Lead растущей историей).
 */
@Schema({ collection: 'leads', timestamps: { createdAt: 'createdAt', updatedAt: false } })
export class LeadDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  contactId!: Types.ObjectId;

  /**
   * Изначально null (не назначен) — назначается explicit командой
   * assignLead, НЕ auto-assignment по умолчанию (owner decision:
   * "Автоматическая раздача может появиться позднее как опция, но не
   * является стартовым поведением").
   */
  @Prop({ type: Types.ObjectId, required: false })
  ownerPositionId?: Types.ObjectId;

  @Prop({ type: LeadSourceSchema, required: true })
  source!: LeadSource;

  /**
   * Опционально — НЕ required (owner decision, продуктовые воронки лида):
   * на проде уже существуют/создаются лиды без него (marketplace
   * reveal-contact-lead flow, CSV/XLSX импорт, обычная ручная форма) и их
   * создание не должно ломаться. Когда задан — `stage` обязан быть одной
   * из стадий ИМЕННО этого продукта (см. lead-stage-definitions.ts);
   * когда не задан — `stage` остаётся в generic-пятёрке LEAD_STAGES, тот
   * же путь, что и до этого прохода. Точная проверка "stage принадлежит
   * productType" — бизнес-логика CrmService (@Prop-enum ниже НЕ может
   * зависеть от значения соседнего поля), не миграция существующих лидов.
   */
  @Prop({ enum: PRODUCT_TYPES, required: false })
  productType?: LeadProductType;

  @Prop({ required: true, enum: ALL_LEAD_STAGE_VALUES, default: 'new' })
  stage!: LeadStage;

  /**
   * conventions.md разд.5 — optimistic concurrency (409 VERSION_CONFLICT),
   * тот же паттерн, что UnitDocument.version. Добавлено 27.08.2026 — до
   * этого changeStage делал безусловный updateOne({_id,organizationId}),
   * два параллельных PATCH .../stage оба проходили stage-transition-проверку
   * против одного и того же прочитанного состояния и оба безусловно
   * записывали (lost update, "последний write выигрывает" без сигнала
   * конфликта ни одному из вызывающих).
   */
  @Prop({ required: true, default: 0 })
  version!: number;

  /**
   * `[phase 3 — 03.09.2026]`, детальная карточка лида (LeadViewModal.tsx):
   * поля, которые легаси `PATCH /crm/leads/:id` (api-crm.baza.sale) уже
   * принимает и которые новый backend до этого прохода не имел вовсе (см.
   * apps/erp-web/src/features/crm/services/api/leads.ts::updateLead
   * `allowed` список — источник этого набора полей, ничего не добавлено
   * сверх него). Все опциональны — сопутствующие атрибуты лида, НЕ его
   * воронку (`stage` остаётся под отдельным версионированным
   * PATCH /leads/:id/stage, этот блок его не трогает).
   */
  @Prop({ required: false })
  city?: string;

  @Prop({ required: false })
  notes?: string;

  @Prop({ type: [String], required: false })
  tags?: string[];

  @Prop({ required: false })
  dealValue?: number;

  @Prop({ required: false })
  budgetValue?: number;

  @Prop({ required: false })
  budgetCurrency?: string;

  @Prop({ required: false })
  expectedCloseDate?: string;

  @Prop({ required: false })
  rejectionReason?: string;

  @Prop({ required: false })
  rejectionComment?: string;

  @Prop({ required: false })
  telegram?: string;

  @Prop({ required: false })
  country?: string;

  /**
   * `[owner decision — 04.09.2026]`: `realtorStage`/`curatorStage` — НЕ
   * дубли `stage`. Найдено чтением
   * apps/erp-web/src/features/crm/components/crm/LeadViewModal.tsx
   * (handleRealtorStageChange/handleCuratorStageChange, отдельные
   * debounce-таймеры от смены `stage`) и types.ts::LeadStage enum: это два
   * НЕЗАВИСИМЫХ 6-шаговых указателя прогресса ('realtor_1'..'realtor_6',
   * 'curator_1'..'curator_6') — СОБСТВЕННАЯ таксономия, отдельная от
   * network-стадий (`network_*`, 17 значений) и от generic-пятёрки, только
   * условно применимая к лидам productType:'network' (UI показывает эти
   * слайдеры при `productType===NETWORK`, backend это не форсирует —
   * гейтинг по продукту остаётся зоной UI, тем же принципом, что и раньше).
   * Владелец подтвердил 04.09.2026: сохранить ровно легаси-таксономию, не
   * упрощать. Хранятся как отдельный литеральный тип (не `LeadStage`),
   * валидируются `REALTOR_STAGE_VALUES`/`CURATOR_STAGE_VALUES`
   * (`lead-stage.ts`) — своим списком из 6 значений каждый, не общим
   * справочником стадии продукта (временное решение до этого коммита).
   */
  @Prop({ enum: REALTOR_STAGE_VALUES, required: false })
  realtorStage?: RealtorStage;

  @Prop({ enum: CURATOR_STAGE_VALUES, required: false })
  curatorStage?: CuratorStage;

  /**
   * `[legacy-base-import]`: WhatsApp-контакт лида — отдельное поле от
   * `telegram` (уже существовало) и от `Contact.phone` (звонок/CRM-канал
   * может быть один, а WhatsApp — другой номер). Заполняется вручную через
   * PATCH /leads/:leadId (общий editableFields-путь) либо колонкой
   * `whatsapp` при импорте старой базы (POST /leads/import).
   */
  @Prop({ required: false })
  whatsapp?: string;

  /**
   * `[legacy-base-import]`: дата последнего контакта с лидом ИЗ СТАРОЙ
   * базы (колонка `last_contact` при импорте) — историческая метка, НЕ
   * серверная метка последнего contact-action в новом backend
   * (recordContactAction её не трогает, это два независимых источника
   * истины: одно "что перенесли из легаси", другое "что происходит здесь и
   * сейчас").
   */
  @Prop({ required: false })
  lastContactAt?: Date;

  /**
   * `[phase 3.1 — checklist]`: чек-лист стадий лида (LeadStageChecklist.tsx
   * во фронте) — плоская карта `"<stage>:<index>" → checked`, НЕ массив с
   * label'ами (в отличие от DealDocument.checklistItems): позиции и текст
   * пунктов чек-листа для КАЖДОЙ стадии продукта — статичная UI-таблица на
   * фронте, сервер хранит только состояние отметки, не сам список пунктов.
   * `type: Object` (Mixed) — тот же приём, что LeadSource.utm, ключи с
   * произвольным именем стадии не описываются decorator'ами. Отсутствующий
   * ключ = не отмечен (не нужно предзаполнять весь набор пунктов при
   * создании лида).
   */
  @Prop({ type: Object, required: false })
  checklist?: Record<string, boolean>;

  /**
   * `[phase 3.1 — checklist]`: заметка, привязанная к КОНКРЕТНОЙ стадии
   * (не к лиду в целом — `notes` уже существует для этого). Карта
   * `stage → {text, updatedAt}`, тот же `type: Object` приём, что
   * `checklist` выше. Пустой `text` в PUT .../stage-notes/:stage удаляет
   * запись целиком (см. CrmService.setLeadStageNote), а не хранит пустую
   * строку — отсутствие ключа и есть "заметки нет".
   */
  @Prop({ type: Object, required: false })
  stageNotes?: Record<string, { text: string; updatedAt: Date }>;

  /**
   * Файлы лида (легаси getLeadFiles/uploadAndRegisterFile/deleteLeadFileByName)
   * — переиспользует MediaModule (ADR-008), тот же паттерн, что
   * PositionDocument.avatarAssetId, только массив (лид может иметь
   * несколько вложений, позиция — один аватар). MediaAsset остаётся
   * единственным источником истины для содержимого/MIME/размера файла —
   * здесь только ссылки, порядок = порядок прикрепления.
   */
  @Prop({ type: [Types.ObjectId], default: [] })
  attachedAssetIds!: Types.ObjectId[];

  /**
   * Имя файла, которое видел пользователь, по assetId вложения. MediaAsset
   * хранит только storage key (`<assetId>/original.pdf`), поэтому без этой
   * записи файл лида показывался как «original.pdf». Нет ключа — имя
   * выводится из storage key, как было до 15.09.2026.
   */
  @Prop({ type: Object, required: false })
  attachedFileNames?: Record<string, string>;

  /**
   * Soft delete (D-канал доступа этого прохода) — тот же принцип, что
   * PositionDocument.status:'closed': лид с историей (LeadEvent/audit/
   * задачи/сделки) не может быть физически удалён без разрушения этой
   * истории, поэтому DELETE /leads/:leadId помечает `status:'deleted'`
   * вместо удаления документа. `findByIdForOrganization`/
   * `listForOrganization` исключают `deleted` лиды тем же `$ne` паттерном,
   * что PositionRepository.findAllByOrganization исключает `closed`.
   */
  @Prop({ required: true, enum: ['active', 'deleted'], default: 'active' })
  status!: 'active' | 'deleted';

  @Prop({ required: false })
  deletedAt?: Date;

  /**
   * `[lead-legacy-migration-tool]`: id лида в легаси-backend (api-crm.baza.sale)
   * — единственный ключ идемпотентности инструмента переноса
   * (LeadMigrationService.importLegacyLeads). Опционально — только у
   * мигрированных лидов оно есть, обычные лиды (marketplace reveal, ручная
   * форма, CSV-импорт) его никогда не заполняют. Unique в пределах
   * организации: повторный прогон миграции с тем же файлом обязан находить
   * уже созданный лид по (organizationId, legacyId) и обновлять его, а не
   * создавать дубль.
   *
   * Индекс ниже — `partialFilterExpression`, НЕ `sparse:true` — найдено
   * реальным прогоном `test:integration` (не гипотетически): у составного
   * `sparse` индекса MongoDB документ включается в индекс, если ХОТЯ БЫ
   * ОДНО из полей присутствует — `organizationId` есть всегда у любого
   * лида, поэтому `sparse` на паре `{organizationId, legacyId}` НЕ
   * пропускал обычные (немигрированные) лиды: все они индексировались с
   * `legacyId: null`, и второй такой лид в организации падал на
   * `E11000 duplicate key` (сломало `lead-import.integration-spec.ts`,
   * `crm-deals`/`lead-management` и другие HTTP-пути создания лида).
   * `partialFilterExpression: {legacyId: {$exists: true}}` индексирует
   * ТОЛЬКО документы, где поле реально установлено — ровно то поведение,
   * которое имелось в виду.
   */
  @Prop({ required: false })
  legacyId?: string;

  declare createdAt: Date;
}

export const LeadSchema = SchemaFactory.createForClass(LeadDocument);

LeadSchema.index({ organizationId: 1, ownerPositionId: 1, stage: 1 });
LeadSchema.index({ contactId: 1 });
LeadSchema.index({ 'source.publicationId': 1 });
LeadSchema.index(
  { organizationId: 1, legacyId: 1 },
  { unique: true, partialFilterExpression: { legacyId: { $exists: true } } },
);
