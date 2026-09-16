import { Injectable, ConflictException } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import type { OwnerScope } from '@baza/tenant-scope';
import {
  MarketplacePublicationRepository,
  type MarketplacePublicationDocument,
  type PublicationSourceType,
} from '@baza/publication';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';

/**
 * ADR-005: generic publish/unpublish command-слой, переиспользуемый для
 * ЛЮБОГО sourceType ('unit' | 'development' | 'listing') — не Development-
 * специфичен, несмотря на то, что D-03 сейчас вызывает его только для
 * Development. Вынесен отдельно от DevelopmentsService, потому что ADR-005
 * явно специфицирует единый MarketplacePublication-паттерн для всех трёх
 * source-типов, а не отдельную реализацию на каждый.
 *
 * НЕ содержит canonical-сущность-специфичную логику (проверка draft→active
 * перехода, whitelist-mapper полей) — это ответственность вызывающего кода
 * (DevelopmentsService.publishDevelopment и т.п.), который знает конкретную
 * canonical-схему. PublicationService знает только про саму
 * MarketplacePublication-запись и общий transactional outbox паттерн.
 */
@Injectable()
export class PublicationService {
  constructor(
    private readonly publicationRepository: MarketplacePublicationRepository,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * ЖК по адресу его карточки на витрине. Нужен второй стороне сделки:
   * агентство нашло комплекс в каталоге платформы и фиксирует у его
   * застройщика клиента (ClientRegistrationsService), а витрина наружу
   * отдаёт slug, не идентификатор. Неопубликованный или чужого типа —
   * null, тот же ответ, что у неизвестного адреса.
   */
  async findPublishedDevelopmentIdBySlug(slug: string): Promise<Types.ObjectId | null> {
    const publication = await this.publicationRepository.findBySlug(slug);
    if (!publication || publication.sourceType !== 'development') return null;
    return publication.sourceId;
  }

  /**
   * ADR-005: команда publish — упсерт MarketplacePublication немедленно со
   * status:publication_pending + outbox-событие PublicationRequested — ОБА
   * в ТОЙ ЖЕ транзакции, что и смена canonical-статуса (session передаётся
   * вызывающим кодом, который уже находится внутри runInTransaction).
   * Сборка полной проекции (denormalizedFields/seo/searchProjection) —
   * worker-задача, реагирующая на PublicationRequested, НЕ выполняется здесь.
   */
  async requestPublication(
    params: {
      sourceType: PublicationSourceType;
      sourceId: Types.ObjectId;
      publisherScope: OwnerScope;
      correlationId: string;
    },
    session: ClientSession,
  ): Promise<MarketplacePublicationDocument> {
    const publication = await this.publicationRepository.upsertPending(
      { sourceType: params.sourceType, sourceId: params.sourceId, publisherScope: params.publisherScope },
      session,
    );

    await this.outboxService.publish(
      {
        eventType: 'PublicationRequested',
        aggregateType: params.sourceType,
        aggregateId: params.sourceId,
        payload: {
          publicationId: publication._id.toString(),
          sourceType: params.sourceType,
          sourceId: params.sourceId.toString(),
          // D-03: version — worker сверяет его атомарно в markPublished
          // (CAS-фильтр), не только использует для дедупликации ключа ниже —
          // защита от того, что более старое событие, обработанное worker'ом
          // ПОСЛЕ более нового (publish, затем rebuild — порядок обработки
          // батча не гарантированно совпадает с порядком создания), затрёт
          // уже актуальную проекцию устаревшими данными.
          version: publication.version,
        },
        // Версия — часть ключа: повторный publish того же source (rebuild)
        // должен породить НОВОЕ событие сборки, не схлопнуться под тем же
        // default-ключом, что предыдущий publish той же сущности.
        deduplicationKey: `${params.sourceType}:${params.sourceId.toString()}:PublicationRequested:v${publication.version}`,
      },
      session,
    );

    return publication;
  }

  /**
   * D-03 rebuild (ИСПРАВЛЕНО 26.08.2026, second-opinion Gemini находка —
   * подтверждена и исправлена, не отклонена): изначальная реализация
   * делала read-then-write — isCurrentlyPublished (отдельный read вне
   * транзакционной session) и ТОЛЬКО ПОТОМ requestPublication (write) —
   * это TOCTOU-гонка: конкурентный admin unpublish между read и write мог
   * быть обойдён (rebuild безусловно переводил publication обратно в
   * publication_pending, не проверяя, не unpublished ли она СЕЙЧАС, в
   * момент самого write). Исправлено на единый атомарный condition-update:
   * upsert выполняется, только если публикация СЕЙЧАС в status:published
   * — MongoDB гарантирует атомарность самого findOneAndUpdate, никакого
   * отдельного read-шага, которому есть что рассинхронизировать, не
   * существует. Возвращает null, если публикация не published (rebuild не
   * применился) — вызывающий код (DevelopmentsService.updateDevelopment)
   * трактует null как "ничего перевыпускать не нужно".
   */
  async rebuildIfCurrentlyPublished(
    params: {
      sourceType: PublicationSourceType;
      sourceId: Types.ObjectId;
      publisherScope: OwnerScope;
      correlationId: string;
    },
    session: ClientSession,
  ): Promise<MarketplacePublicationDocument | null> {
    const publication = await this.publicationRepository.markPendingIfPublished(
      params.sourceType,
      params.sourceId,
      params.publisherScope,
      session,
    );
    if (!publication) {
      return null;
    }

    await this.outboxService.publish(
      {
        eventType: 'PublicationRequested',
        aggregateType: params.sourceType,
        aggregateId: params.sourceId,
        payload: {
          publicationId: publication._id.toString(),
          sourceType: params.sourceType,
          sourceId: params.sourceId.toString(),
          version: publication.version,
        },
        deduplicationKey: `${params.sourceType}:${params.sourceId.toString()}:PublicationRequested:v${publication.version}`,
      },
      session,
    );

    return publication;
  }

  /**
   * ADR-005: unpublish — АСИММЕТРИЧНО publish, синхронная операция в той
   * же API-транзакции, что смена canonical-статуса (не worker-задача —
   * сокрытие уже существующей проекции дёшево, один update по
   * индексированному ключу). reason обязателен (permission-matrix.md
   * раздел 4: critical admin action требует reason).
   *
   * ACT-001: `actorType: 'system'` добавлен для автоматического unpublish
   * просроченного listing (ActualityService.expireOverdueListings) — тот
   * же actor-тип, что уже используется в D-05 revealContact (гость без
   * идентичности создаёт Lead через system actor). `actorId` опционален
   * ТОЛЬКО для этого типа (AuditActorType уже поддерживал `system` без id
   * на уровне схемы, PublicationService раньше сужал типы до
   * identity/admin_account без причины, специфичной именно для publication).
   */
  async unpublish(
    params: {
      sourceType: PublicationSourceType;
      sourceId: Types.ObjectId;
      reason: string;
    } & ({ actorType: 'identity' | 'admin_account'; actorId: Types.ObjectId } | { actorType: 'system'; actorId?: Types.ObjectId }) & {
      correlationId: string;
    },
    session: ClientSession,
  ): Promise<void> {
    const { modifiedCount } = await this.publicationRepository.unpublish(
      params.sourceType,
      params.sourceId,
      params.reason,
      session,
    );

    if (modifiedCount === 0) {
      // Публикация не в status:published — либо никогда не публиковалась,
      // либо уже unpublished. Не NotFoundException молча — вызывающий код
      // (admin unpublish endpoint) должен явно решить, как это трактовать
      // (обычно ConflictException — "уже не опубликовано", не "не найдено",
      // поскольку сама canonical-сущность при этом реально существует).
      throw new ConflictException('Publication is not currently published');
    }

    await this.auditService.append(
      {
        actor: { type: params.actorType, id: params.actorId },
        action: 'publication.unpublish',
        resource: params.sourceType,
        resourceId: params.sourceId,
        reason: params.reason,
        correlationId: params.correlationId,
      },
      session,
    );

    await this.outboxService.publish(
      {
        eventType: 'UnpublicationRequested',
        aggregateType: params.sourceType,
        aggregateId: params.sourceId,
        payload: { sourceType: params.sourceType, sourceId: params.sourceId.toString(), reason: params.reason },
        deduplicationKey: `${params.sourceType}:${params.sourceId.toString()}:UnpublicationRequested`,
      },
      session,
    );
  }
}
