import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { Currency } from '@baza/contracts';
import { DevelopmentDocument, DevelopmentLocation, DevelopmentContact } from '../schemas/development.schema';

/**
 * Единственная точка доступа к коллекции developments (ADR-002 требование 2).
 * Используется API-процессом (create/CRUD, tenant-scoped методы) и worker-
 * процессом (findById — без tenant-фильтра, worker читает по sourceId из
 * outbox-события payload, не имеет tenant-сессии в том же смысле, что API).
 */
@Injectable()
export class DevelopmentRepository {
  constructor(
    @InjectModel(DevelopmentDocument.name) private readonly model: Model<DevelopmentDocument>,
  ) {}

  async create(
    params: {
      organizationId: Types.ObjectId;
      name: string;
      location: DevelopmentLocation;
      contact: DevelopmentContact;
      classType?: string;
      startDate?: Date;
      completionDate?: Date;
      description?: string;
    },
    session?: ClientSession,
  ): Promise<DevelopmentDocument> {
    const [doc] = await this.model.create([{ ...params, status: 'draft', version: 0 }], { session });
    return doc!;
  }

  /**
   * ADR-002 требование 1: organizationId — часть фильтра, не отдельная
   * post-fetch проверка — findById без tenant-фильтра возвращал бы любой
   * Development вне зависимости от организации вызывающего, что было бы
   * IDOR (тот же класс проблемы, что уже закрывался в media/organizations
   * модулях). NOT_FOUND единый для "не существует" и "чужая организация"
   * (error-catalog.md).
   */
  async findByIdForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
  ): Promise<DevelopmentDocument | null> {
    return this.model.findOne({ _id: id, organizationId }).exec();
  }

  /**
   * Worker-side: без tenant-фильтра — worker обрабатывает outbox-события
   * как system actor (ADR-002), не как identity-сессия конкретной
   * организации; sourceId уже пришёл из доверенного internal-payload
   * (outbox-событие, публикуемое тем же кодовым артефактом), не от
   * недоверенного внешнего клиента — тот же принцип, что MediaVerified
   * payload в apps/worker/src/handlers/media-verified.handler.ts.
   */
  async findById(id: Types.ObjectId): Promise<DevelopmentDocument | null> {
    return this.model.findById(id).exec();
  }

  /**
   * Опубликованный комплекс без привязки к организации-читателю. Нужен
   * второй стороне сделки: агентство фиксирует клиента у ЧУЖОГО
   * застройщика и обязано увидеть имя комплекса и его владельца
   * (ClientRegistrationsService.resolveTarget). `status: 'active'` в
   * фильтре обязателен: по id нельзя узнавать о чужих черновиках и
   * архиве, наружу отдаётся только то, что застройщик уже опубликовал.
   */
  async findPublishedById(id: Types.ObjectId): Promise<DevelopmentDocument | null> {
    return this.model.findOne({ _id: id, status: 'active' }).exec();
  }

  async listForOrganization(
    organizationId: Types.ObjectId,
    params: { cursor?: Types.ObjectId; limit: number },
  ): Promise<DevelopmentDocument[]> {
    const filter: Record<string, unknown> = { organizationId };
    if (params.cursor) {
      filter._id = { $gt: params.cursor };
    }
    return this.model.find(filter).sort({ _id: 1 }).limit(params.limit).exec();
  }

  /**
   * Optimistic concurrency (conventions.md разд.5): update условен на
   * ожидаемой version — при несовпадении modifiedCount:0, вызывающий код
   * трактует это как VERSION_CONFLICT (409), не как "запись не найдена".
   */
  async updateWithVersionCheck(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    expectedVersion: number,
    changes: Partial<{
      name: string;
      location: DevelopmentLocation;
      contact: DevelopmentContact;
      classType: string;
      startDate: Date;
      completionDate: Date;
      description: string;
    }>,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne(
        { _id: id, organizationId, version: expectedVersion },
        { $set: changes, $inc: { version: 1 } },
        { session },
      )
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * fromStatus — compare-and-swap источника: фильтр раньше проверял только
   * {_id, organizationId}, БЕЗ условия на текущий status — не был реальным
   * атомарным CAS. Найдено реальным integration-тестом (два параллельных
   * HTTP publish с одним Idempotency-Key, MongoDB transaction snapshot
   * isolation): обе конкурентные транзакции читают status:'draft' в СВОИХ
   * снапшотах ДО того, как любая из них закоммитит, затем ОБЕ проходят этот
   * updateOne (фильтр без status ничего не отсекает), обе получают
   * modifiedCount:1, обе идут дальше писать idempotency record с одним и
   * тем же (identityId, operation, key) — второй insert падает E11000,
   * который DevelopmentsService.publishDevelopment не ловил (ожидал
   * modifiedCount:0 как единственный сигнал гонки, тут его не было).
   * Явный status:fromStatus в фильтре делает победителя гонки единственным
   * (проигравший теперь корректно получает modifiedCount:0, что уже
   * обрабатывается веткой checkReplay/ConflictException выше по стеку).
   */
  /**
   * CAS-захват валюты ЖК (см. DevelopmentDocument.currency). Должен быть
   * ПЕРВОЙ записью в транзакции createUnit/updateUnitPrice — тот же
   * принцип, что BookingLockRepository.bumpForUnit: конкурентная
   * транзакция, пытающаяся записать в тот же документ, получает от
   * MongoDB write conflict и повторяется (withTransaction retry), поэтому
   * вторая по факту видит уже установленную первой транзакцией валюту,
   * а не пустое состояние в собственном обособленном снапшоте.
   *
   * `ok:true` — валюта только что установлена (документ ранее её не имел)
   * ЛИБО уже совпадала с requested. `ok:false` — уже стоит другая валюта,
   * currentCurrency называет её для сообщения об ошибке.
   */
  async lockCurrency(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    currency: Currency,
    session: ClientSession,
    options: { allowReplacing?: Currency } = {},
  ): Promise<{ ok: true } | { ok: false; currentCurrency?: Currency }> {
    const or: Record<string, unknown>[] = [{ currency: { $exists: false } }, { currency: null }, { currency }];
    if (options.allowReplacing) {
      // Переприсвоение: вызывающий уже убедился (в той же транзакции), что
      // текущую валюту не держит больше никто, кроме юнита, чью валюту он
      // сейчас меняет — допускаем замену только с ЭТОГО конкретного
      // значения, а не с любого, иначе тут же потерялась бы вся защита.
      or.push({ currency: options.allowReplacing });
    }
    const locked = await this.model
      .findOneAndUpdate(
        { _id: id, organizationId, $or: or },
        { $set: { currency } },
        { session, new: true },
      )
      .exec();
    if (locked) {
      return { ok: true };
    }
    const current = await this.model.findOne({ _id: id, organizationId }).session(session).exec();
    return { ok: false, currentCurrency: current?.currency };
  }

  async updateStatus(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    fromStatus: 'draft' | 'active' | 'archived',
    toStatus: 'draft' | 'active' | 'archived',
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateOne(
        { _id: id, organizationId, status: fromStatus },
        { $set: { status: toStatus }, $inc: { version: 1 } },
        { session },
      )
      .exec();
    return { modifiedCount: result.modifiedCount };
  }
}
