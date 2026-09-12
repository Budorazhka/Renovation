import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrganizationType = 'agency' | 'developer' | 'independent_realtor';
export type OrganizationStatus = 'active' | 'frozen' | 'archived';

/**
 * docs/architecture/domain-model.md Модуль 2 / mongodb-schema.md `organizations`.
 * Не содержит organizationId сама (корень tenant-границы, ADR-002).
 */
@Schema({ collection: 'organizations', timestamps: { createdAt: 'createdAt', updatedAt: false } })
export class OrganizationDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, enum: ['agency', 'developer', 'independent_realtor'] })
  type!: OrganizationType;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, enum: ['active', 'frozen', 'archived'], default: 'active' })
  status!: OrganizationStatus;

  /**
   * N-10 (roadmap-2026-09.md, решение владельца 11.09.2026): биржа MLS
   * (`community` type:'exchange') видна только проверенным агентствам и
   * риэлторам — застройщики её не видят вообще, независимо от этого поля
   * (мастер-план §2.3: MLS требует отдельной регистрации и верификации).
   * Верхнеуровневый процесс верификации закрыт владельцем («сотрудник BAZA
   * вручную, по телефону/документам агентства») — точный список проверяемых
   * документов и причины отзыва статуса открыты для отдельного ADR
   * (BAZA_MASTER_PLAN.md разд.14, пункт B-01), поэтому здесь только сам
   * флаг и его смена через AdminOrganizationService (audit хранит
   * кто/когда/почему — то же решение, что и `status`, у которого тоже нет
   * дублирующих frozenAt/frozenBy на этом документе).
   */
  @Prop({ required: true, default: false })
  mlsVerified!: boolean;

  /**
   * `[organization-legacy-migration]`: id компании (застройщик/агентство) в
   * старой системе — ключ идемпотентности для будущего одноразового
   * скрипта переноса, тот же принцип, что lead.schema.ts::legacyId:
   * повторный прогон импорта обязан находить уже созданную Organization по
   * legacyId и обновлять её, а не заводить дубль. Опционально — только у
   * мигрированных организаций оно есть, обычная регистрация
   * (registerOrganizationOwner) его никогда не заполняет.
   *
   * Индекс — глобальный unique, НЕ составной с organizationId: Organization
   * сама является корнем tenant-границы (см. докстринг класса выше, ADR-002)
   * и не хранит собственный organizationId, поэтому scoping-ключ, которым
   * lead.schema.ts ограничивает уникальность внутри организации, здесь
   * просто отсутствует — уникальность legacyId имеет смысл только
   * глобально. `sparse:true` безопасен для одиночного поля индекса (не
   * составной ключ, ловушка из lead.schema.ts на compound-индексе здесь не
   * применима).
   */
  @Prop({ required: false })
  legacyId?: string;

  declare createdAt: Date;
}

export const OrganizationSchema = SchemaFactory.createForClass(OrganizationDocument);
OrganizationSchema.index({ type: 1, status: 1 });
OrganizationSchema.index({ legacyId: 1 }, { unique: true, sparse: true });
