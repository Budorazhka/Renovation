import { Schema as MongooseSchema, Types } from 'mongoose';

export type OwnerScopeType = 'organization' | 'marketplace_account' | 'platform';

/**
 * domain-model.md: паттерн для сущностей, принадлежащих либо организации
 * (ERP), либо независимому marketplace-аккаунту без ERP (собственник,
 * продающий без агентства). Один из двух id всегда присутствует, никогда
 * оба — сериализуется как discriminated union `{type, organizationId}` или
 * `{type, identityId}`, не два опциональных поля на плоском уровне (что
 * допускало бы невалидное состояние "оба заданы" без явного отказа).
 *
 * Живёт в @baza/tenant-scope (не в apps/api) — не media-специфичный
 * паттерн (domain-model.md явно называет его переиспользуемым для listings/
 * selections тоже), и MediaAssetDocument (@baza/media-storage), читаемый
 * и API, и worker-процессом, использует этот же тип — дублирование в двух
 * apps создало бы риск рассинхронизации.
 */
export type OwnerScope =
  | { type: 'organization'; organizationId: Types.ObjectId }
  | { type: 'marketplace_account'; identityId: Types.ObjectId }
  | PlatformOwnerScope;

/**
 * Контент самой платформы BAZA — ничей из тенантов (15.09.2026: картинки к
 * новостям платформы, которые публикует админка). Идентификатора у него нет:
 * платформа одна. Ни TenantContext, ни marketplace-сессия такой scope не
 * порождают — его выставляет только admin-контур.
 */
export type PlatformOwnerScope = { type: 'platform' };

export const PLATFORM_OWNER_SCOPE: PlatformOwnerScope = { type: 'platform' };

/**
 * Вложенная Mongoose-схема, как AuditActorSchema — поле `type` внутри
 * объекта конфликтует с зарезервированным SchemaTypeOptions.type при
 * inline-объявлении (см. audit-event.schema.ts), поэтому вынесена отдельно.
 * Хранится с обоими id как sparse optional — какой из двух заполнен,
 * определяется полем `type`; невалидную комбинацию (оба или ни одного)
 * приложение обязано не допускать на уровне command-слоя, не схемы (Mongoose
 * не поддерживает conditional required между sibling-полями декларативно).
 */
export const OwnerScopeSchema = new MongooseSchema(
  {
    type: { type: String, enum: ['organization', 'marketplace_account', 'platform'], required: true },
    organizationId: { type: MongooseSchema.Types.ObjectId, required: false },
    identityId: { type: MongooseSchema.Types.ObjectId, required: false },
  },
  { _id: false },
);

/**
 * ADR-002 требование 1: сравнение server-derived ожидаемого scope с
 * фактическим scope записи, найденной по id из URL/body — единственный
 * способ безопасно сверить tenant-принадлежность для сущностей с
 * publisherScope/ownerScope паттерном (не только сравнение type, но и
 * конкретного id внутри соответствующей ветки union).
 */
export function ownerScopesEqual(a: OwnerScope, b: OwnerScope): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'organization' && b.type === 'organization') {
    return a.organizationId.equals(b.organizationId);
  }
  if (a.type === 'marketplace_account' && b.type === 'marketplace_account') {
    return a.identityId.equals(b.identityId);
  }
  if (a.type === 'platform' && b.type === 'platform') {
    return true;
  }
  return false;
}
