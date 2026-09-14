import { leadChecklistApiV2, leadsApiV2, newIdempotencyKey } from '@/services/leadsApiV2';
import { mediaApiV2 } from '@/services/mediaApiV2';
import { mapLeadV2ToCrmLead, mapProductTypeCrmToV2, stageCrmToV2, stageV2ToCrm } from '@/lib/lead-v2-legacy-adapter';
import type { LeadFileV2, UpdateLeadV2Payload } from '@/types/leadsV2';
import type { ApiResponse, CreateLeadDto, Lead, LeadFile, LeadStage, UpdateLeadDto, UpdateLeadStageDto } from './api';

/**
 * Лиды платформы в легаси-форме классической CRM (методы и ответы
 * {success, data} как у старого apiService) — для CreateClientModal и
 * LeadStageChecklist.
 */

function failure<T>(error: unknown): ApiResponse<T> {
  const err = error as { response?: { data?: { message?: string } }; message?: string };
  return { success: false, message: err.response?.data?.message || err.message || 'Ошибка запроса' };
}

/** `filename` у файла лида — это assetId: по нему файл удаляется. */
export function mapLeadFileV2ToCrm(file: LeadFileV2): LeadFile {
  return {
    filename: file.assetId,
    originalName: file.fileName,
    mimeType: file.mimeType ?? '',
    size: file.sizeBytes,
    url: file.url ?? '',
  };
}

/**
 * Легаси UpdateLeadDto → PATCH /leads/:id. Стадия идёт отдельно (PATCH
 * /stage), исполнитель — через /assign. `source` («Тип сделки - Тип объекта»)
 * у лида платформы не хранится.
 */
export function toUpdateLeadPayload(dto: UpdateLeadDto): UpdateLeadV2Payload {
  const payload: UpdateLeadV2Payload = {};
  if (dto.name !== undefined) payload.name = dto.name.trim();
  if (dto.phone !== undefined) payload.phone = dto.phone.trim();
  if (dto.email !== undefined) payload.email = dto.email.trim() || null;
  if (dto.productType !== undefined) payload.productType = mapProductTypeCrmToV2(dto.productType);
  if (dto.city !== undefined) payload.city = dto.city;
  if (dto.notes !== undefined) payload.notes = dto.notes;
  if (dto.tags !== undefined) payload.tags = dto.tags;
  if (dto.dealValue !== undefined) payload.dealValue = dto.dealValue;
  if (dto.budgetValue !== undefined) payload.budgetValue = dto.budgetValue;
  if (dto.budgetCurrency !== undefined) payload.budgetCurrency = dto.budgetCurrency;
  if (dto.expectedCloseDate !== undefined) payload.expectedCloseDate = dto.expectedCloseDate;
  if (dto.rejectionReason !== undefined) payload.rejectionReason = dto.rejectionReason;
  if (dto.rejectionComment !== undefined) payload.rejectionComment = dto.rejectionComment;
  if (dto.realtorStage !== undefined) payload.realtorStage = dto.realtorStage;
  if (dto.curatorStage !== undefined) payload.curatorStage = dto.curatorStage;
  return payload;
}

async function changeStage(leadId: string, stage: LeadStage, comment?: string) {
  const current = await leadsApiV2.getById(leadId);
  await leadsApiV2.changeStage(leadId, stageCrmToV2(stage), current.version, newIdempotencyKey(), comment);
  return mapLeadV2ToCrmLead(await leadsApiV2.getById(leadId));
}

export const leadCrmService = {
  async getLead(leadId: string): Promise<ApiResponse<Lead>> {
    try {
      return { success: true, data: mapLeadV2ToCrmLead(await leadsApiV2.getById(leadId)) };
    } catch (error) {
      return failure(error);
    }
  },

  /**
   * Создание — POST /leads (имя, телефон, продукт), остальные поля формы
   * дописываются правкой. Лид с уже известным телефоном сервер не отклоняет:
   * он переиспользует контакт и создаёт новый лид.
   */
  async createLead(dto: CreateLeadDto): Promise<ApiResponse<Lead>> {
    try {
      const created = await leadsApiV2.create(
        { requesterName: dto.name.trim(), requesterPhone: dto.phone.trim(), productType: mapProductTypeCrmToV2(dto.productType) },
        newIdempotencyKey(),
      );
      const rest = toUpdateLeadPayload({
        email: dto.email,
        city: dto.city,
        notes: dto.notes,
        dealValue: dto.dealValue,
        budgetValue: dto.budgetValue,
        budgetCurrency: dto.budgetCurrency,
        expectedCloseDate: dto.expectedCloseDate,
      });
      if (rest.email === null) delete rest.email;
      const lead = Object.keys(rest).length > 0 ? await leadsApiV2.update(created.id, rest) : created;
      return { success: true, data: mapLeadV2ToCrmLead(lead) };
    } catch (error) {
      return failure(error);
    }
  },

  /** Поля формы — PATCH; стадия (если передана и продукт не менялся) — отдельной сменой стадии. */
  async updateLead(leadId: string, dto: UpdateLeadDto): Promise<ApiResponse<Lead>> {
    try {
      const payload = toUpdateLeadPayload(dto);
      let lead = Object.keys(payload).length > 0 ? mapLeadV2ToCrmLead(await leadsApiV2.update(leadId, payload)) : null;
      // При смене продукта сервер сам сбрасывает стадию в «Новый лид» нового продукта.
      if (dto.stage !== undefined && payload.productType === undefined) lead = await changeStage(leadId, dto.stage);
      return { success: true, data: lead ?? mapLeadV2ToCrmLead(await leadsApiV2.getById(leadId)) };
    } catch (error) {
      return failure(error);
    }
  },

  async updateLeadStage(leadId: string, dto: UpdateLeadStageDto): Promise<ApiResponse<Lead>> {
    try {
      if (!dto.stage) return { success: true, data: mapLeadV2ToCrmLead(await leadsApiV2.getById(leadId)) };
      return { success: true, data: await changeStage(leadId, dto.stage, dto.comment) };
    } catch (error) {
      return failure(error);
    }
  },

  async getChecklistState(leadId: string): Promise<ApiResponse<{ items: Array<{ stage: LeadStage; index: number; checked: boolean }> }>> {
    try {
      const { items } = await leadChecklistApiV2.get(leadId);
      return { success: true, data: { items: items.map((i) => ({ ...i, stage: stageV2ToCrm(i.stage) })) } };
    } catch (error) {
      return failure(error);
    }
  },

  async saveChecklistState(
    leadId: string,
    items: Array<{ stage: LeadStage; index: number; checked: boolean }>,
  ): Promise<ApiResponse<{ leadId: string; savedCount: number }>> {
    try {
      await leadChecklistApiV2.update(leadId, items.map((i) => ({ ...i, stage: stageCrmToV2(i.stage) })));
      return { success: true, data: { leadId, savedCount: items.length } };
    } catch (error) {
      return failure(error);
    }
  },

  async getStageComment(leadId: string, stage: LeadStage): Promise<ApiResponse<{ comment: string } | null>> {
    try {
      const { stageNotes } = await leadChecklistApiV2.get(leadId);
      const note = stageNotes.find((n) => n.stage === stageCrmToV2(stage));
      return { success: true, data: note ? { comment: note.text } : null };
    } catch (error) {
      return failure(error);
    }
  },

  async createStageComment(leadId: string, stage: LeadStage, comment: string): Promise<ApiResponse<{ comment: string }>> {
    try {
      const note = await leadChecklistApiV2.putStageNote(leadId, stageCrmToV2(stage), comment);
      return { success: true, data: { comment: note.text } };
    } catch (error) {
      return failure(error);
    }
  },

  async getLeadFiles(leadId: string): Promise<ApiResponse<{ files: LeadFile[]; count: number }>> {
    try {
      const files = (await leadsApiV2.listFiles(leadId)).map(mapLeadFileV2ToCrm);
      return { success: true, data: { files, count: files.length } };
    } catch (error) {
      return failure(error);
    }
  },

  async deleteLeadFileByName(leadId: string, filename: string): Promise<ApiResponse<{ files: LeadFile[] }>> {
    try {
      const files = (await leadsApiV2.removeFile(leadId, filename)).map(mapLeadFileV2ToCrm);
      return { success: true, data: { files } };
    } catch (error) {
      return failure(error);
    }
  },

  /** Каждый файл — в хранилище платформы (lead_attachment), затем привязывается к лиду. */
  async uploadLeadFiles(leadId: string, files: File[]): Promise<ApiResponse<{ files: LeadFile[] }>> {
    try {
      let current: LeadFileV2[] = [];
      for (const file of files) {
        const { assetId } = await mediaApiV2.uploadFile(file, 'lead_attachment');
        current = await leadsApiV2.attachFile(leadId, assetId);
      }
      return { success: true, data: { files: current.map(mapLeadFileV2ToCrm) } };
    } catch (error) {
      return failure(error);
    }
  },
};
