import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { Connection, Types } from 'mongoose';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { MarketplaceSelectionRepository } from './repository/marketplace-selection.repository';
import type {
  MarketplaceSelectionDocument,
  MarketplaceSelectionItemType,
} from './schemas/marketplace-selection.schema';

export interface MarketplaceSelectionView {
  id: string;
  title: string;
  items: Array<{ targetType: MarketplaceSelectionItemType; slug: string; addedAt: string }>;
  publicToken: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Публичная проекция (без identityId/внутреннего id) — тот же принцип, что
 * PublicDevSelection: тот, кому владелец переслал ссылку, не должен видеть
 * ничего сверх названия и списка объектов.
 */
export interface PublicMarketplaceSelection {
  title: string;
  items: Array<{ targetType: MarketplaceSelectionItemType; slug: string }>;
  createdAt: string;
}

function toView(doc: MarketplaceSelectionDocument): MarketplaceSelectionView {
  return {
    id: doc._id.toString(),
    title: doc.title,
    items: doc.items.map((item) => ({
      targetType: item.targetType,
      slug: item.slug,
      addedAt: item.addedAt.toISOString(),
    })),
    publicToken: doc.publicToken,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toPublicView(doc: MarketplaceSelectionDocument): PublicMarketplaceSelection {
  return {
    title: doc.title,
    items: doc.items.map((item) => ({ targetType: item.targetType, slug: item.slug })),
    createdAt: doc.createdAt.toISOString(),
  };
}

/**
 * N-11: подборки покупателя, привязанные к его identity, не к организации
 * (тот же module-boundary принцип, что FavoritesService — отдельный модуль,
 * не часть `selections` (CRM-подборки агента, organization-scoped)).
 */
@Injectable()
export class MarketplaceSelectionsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly repository: MarketplaceSelectionRepository,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /** 256 бит энтропии — см. докстринг MarketplaceSelectionDocument.publicToken. */
  private generatePublicToken(): string {
    return randomBytes(32).toString('hex');
  }

  async list(identityId: Types.ObjectId): Promise<MarketplaceSelectionView[]> {
    const docs = await this.repository.listForIdentity(identityId);
    return docs.map(toView);
  }

  /**
   * Создание НЕ идемпотентно по построению (в отличие от favorites/add) —
   * каждый вызов заводит новую подборку, повторный клик создал бы вторую
   * пустую. Поэтому, в отличие от favorites, здесь настоящий
   * Idempotency-Key флоу (ADR-006), тот же паттерн, что
   * DevelopmentsService.createUnit/CommunityService.createThread.
   */
  async create(params: {
    identityId: Types.ObjectId;
    title: string;
    idempotencyKey: string;
  }): Promise<MarketplaceSelectionView> {
    const requestBody = { title: params.title };
    const replay = await this.idempotencyService.checkReplay({
      identityId: params.identityId,
      operation: 'createMarketplaceSelection',
      key: params.idempotencyKey,
      requestBody,
    });
    if (replay) {
      return replay.responseBody as unknown as MarketplaceSelectionView;
    }

    return runInTransaction(this.connection, async (session) => {
      const created = await this.repository.create(
        params.identityId,
        params.title,
        this.generatePublicToken(),
        session,
      );
      const response = toView(created);

      await this.idempotencyService.record(
        {
          identityId: params.identityId,
          operation: 'createMarketplaceSelection',
          key: params.idempotencyKey,
          requestBody,
          responseStatus: 201,
          responseBody: response as unknown as Record<string, unknown>,
        },
        session,
      );

      return response;
    });
  }

  /** Переименование идемпотентно: тот же title дважды приводит к тому же итогу — Idempotency-Key не нужен. */
  async rename(id: Types.ObjectId, identityId: Types.ObjectId, title: string): Promise<MarketplaceSelectionView> {
    const updated = await this.repository.rename(id, identityId, title);
    if (!updated) {
      throw new NotFoundException('Selection not found');
    }
    return toView(updated);
  }

  /** Удаление тоже идемпотентно: повторное удаление возвращает removed:false, а не ошибку. */
  async remove(id: Types.ObjectId, identityId: Types.ObjectId): Promise<{ removed: boolean }> {
    return { removed: await this.repository.remove(id, identityId) };
  }

  /**
   * Существование объекта по slug здесь НЕ проверяется — тот же принцип и
   * то же обоснование, что FavoritesService.remove: публичные карточки
   * читаются без аутентификации, проверка ничего не защитила бы и стоила
   * бы лишнего запроса на каждое добавление.
   */
  async addItem(
    id: Types.ObjectId,
    identityId: Types.ObjectId,
    targetType: MarketplaceSelectionItemType,
    slug: string,
  ): Promise<MarketplaceSelectionView> {
    const updated = await this.repository.addItem(id, identityId, targetType, slug);
    if (updated) {
      return toView(updated);
    }
    // findOneAndUpdate вернул null: либо подборка чужая/не существует, либо
    // элемент там уже есть (идемпотентный случай) — различаем повторным
    // чтением, а не второй похожей записью в репозитории.
    const existing = await this.repository.findByIdForIdentity(id, identityId);
    if (!existing) {
      throw new NotFoundException('Selection not found');
    }
    return toView(existing);
  }

  async removeItem(
    id: Types.ObjectId,
    identityId: Types.ObjectId,
    targetType: MarketplaceSelectionItemType,
    slug: string,
  ): Promise<MarketplaceSelectionView> {
    const updated = await this.repository.removeItem(id, identityId, targetType, slug);
    if (!updated) {
      throw new NotFoundException('Selection not found');
    }
    return toView(updated);
  }

  /** ПУБЛИЧНЫЙ путь — единственный ключ доступа это сам publicToken, см. репозиторий. */
  async getPublic(publicToken: string): Promise<PublicMarketplaceSelection> {
    const found = await this.repository.findByPublicToken(publicToken);
    if (!found) {
      throw new NotFoundException('Selection not found');
    }
    return toPublicView(found);
  }
}
