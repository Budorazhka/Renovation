import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { ContactDocument, ContactRole } from '../schemas/contact.schema';

/**
 * Единственная точка доступа к коллекции contacts (ADR-002 требование 2).
 */
@Injectable()
export class ContactRepository {
  constructor(@InjectModel(ContactDocument.name) private readonly model: Model<ContactDocument>) {}

  /**
   * domain-model.md Module 7 invariant: tenant-local dedupe по phone —
   * только внутри организации, cross-tenant существование не раскрывается.
   */
  async findByPhone(organizationId: Types.ObjectId, phone: string): Promise<ContactDocument | null> {
    return this.model.findOne({ organizationId, phone }).exec();
  }

  async create(
    params: { organizationId: Types.ObjectId; name: string; phone: string; email?: string; roles: ContactRole[] },
    session?: ClientSession,
  ): Promise<ContactDocument> {
    const [doc] = await this.model.create([params], { session });
    return doc!;
  }

  async findByIdForOrganization(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ContactDocument | null> {
    return this.model.findOne({ _id: id, organizationId }, null, { session }).exec();
  }

  /**
   * CRM list read-model: contacts всегда выбираются вместе с тем же
   * organizationId, даже когда id уже пришли из tenant-scoped leads. Это
   * не избыточная проверка: не даёт превратить ошибочную ссылку contactId
   * в утечку контакта другой организации.
   */
  async findByIdsForOrganization(
    organizationId: Types.ObjectId,
    ids: Types.ObjectId[],
  ): Promise<ContactDocument[]> {
    if (ids.length === 0) return [];
    return this.model.find({ _id: { $in: ids }, organizationId }).exec();
  }

  /**
   * GET /contacts/:contactId — тот же non-disclosure паттерн, что
   * LeadRepository.findByIdForOrganization: organizationId в фильтре
   * обязателен, чужой контакт неотличим от несуществующего.
   */
  async findByIdForOrganizationScoped(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    contactIds?: Types.ObjectId[],
  ): Promise<ContactDocument | null> {
    if (contactIds && !contactIds.some((candidate) => candidate.equals(id))) {
      // own-scope: contactId вне множества "своих" контактов — тот же
      // 404, что просто отсутствующий id (CrmService решает код ответа,
      // здесь только null vs документ).
      return null;
    }
    return this.model.findOne({ _id: id, organizationId }).exec();
  }

  /**
   * PATCH /leads/:leadId — правка name/phone/email контакта, ПРИВЯЗАННОГО к
   * лиду (не контакта по его собственному id — тот путь не существует
   * сегодня). `email: null` очищает поле (`$unset`), отсутствие поля в
   * `fields` — "не трогать" (тот же partial-PATCH принцип, что
   * LeadRepository.updateFields). Дедупликация по телефону — забота
   * вызывающего (CrmService.updateLead: findByPhone ДО вызова этого
   * метода), сам repository ничего не проверяет.
   */
  async updateFields(
    id: Types.ObjectId,
    organizationId: Types.ObjectId,
    fields: { name?: string; phone?: string; email?: string | null },
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const set: Record<string, unknown> = {};
    if (fields.name !== undefined) set.name = fields.name;
    if (fields.phone !== undefined) set.phone = fields.phone;
    if (fields.email !== undefined && fields.email !== null) set.email = fields.email;

    const update: Record<string, unknown> = {};
    if (Object.keys(set).length > 0) update.$set = set;
    if (fields.email === null) update.$unset = { email: '' };

    const result = await this.model
      .updateOne({ _id: id, organizationId }, update, { session })
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * GET /contacts — cursor pagination по `_id` (тот же принцип, что
   * LeadRepository.listForOrganization/AuditEventRepository.listForAdmin):
   * ObjectId монотонно возрастает и уникален, `_id`-курсор не имеет
   * дублей/пропусков. contactIds (own-scope сужение — резолвится ДО
   * вызова этого метода из LeadRepository.distinctContactIdsForOwner,
   * repository не знает про Lead/scope) применяется как AND-условие
   * `_id: {$in: contactIds}`, никогда постфильтрацией уже прочитанного
   * списка. `q` — регистронезависимый partial-match по name ИЛИ phone,
   * метасимволы regex экранируются вызывающим кодом (см. escapeRegex в
   * crm.service.ts) до попадания сюда — repository сам по себе не
   * защищает от ReDoS/injection, это ответственность caller'а, единого
   * места сборки $regex во всём CRM read-path.
   */
  async listForOrganization(
    organizationId: Types.ObjectId,
    params: { contactIds?: Types.ObjectId[]; q?: RegExp; cursor?: Types.ObjectId; limit: number },
  ): Promise<ContactDocument[]> {
    if (params.contactIds && params.contactIds.length === 0) {
      // own-scope с пустым множеством лидов у этой Position — не 0 ни для
      // одной организации (Mongo $in:[] всегда пусто), явный early-return
      // экономит бесполезный поход в базу.
      return [];
    }
    const filter: Record<string, unknown> = {
      organizationId,
      ...(params.contactIds ? { _id: { $in: params.contactIds } } : {}),
      ...(params.q ? { $or: [{ name: params.q }, { phone: params.q }] } : {}),
    };
    if (params.cursor) {
      filter._id = params.contactIds
        ? { $in: params.contactIds, $lt: params.cursor }
        : { $lt: params.cursor };
    }
    return this.model.find(filter).sort({ _id: -1 }).limit(params.limit).exec();
  }
}
