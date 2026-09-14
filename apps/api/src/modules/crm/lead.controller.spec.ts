import { Types } from 'mongoose';
import { LeadController } from './lead.controller';
import type { CrmService } from './crm.service';
import type { PolicyEvaluatorService } from '../authorization/policy-evaluator.service';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';

/** Повторов в этих тестах нет: checkReplay всегда отдаёт null. */
const noReplay = () => ({ checkReplay: jest.fn().mockResolvedValue(null) }) as unknown as IdempotencyService;

function makeRequest(organizationId: Types.ObjectId, positionId: Types.ObjectId) {
  return {
    tenantContext: {
      organizationId: organizationId.toString(),
      positionId: positionId.toString(),
      identityId: new Types.ObjectId().toString(),
    },
  };
}

describe('LeadController.createLead', () => {
  it('пробрасывает contactId/requesterName/requesterPhone + actor/organization из tenantContext', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const createLead = jest.fn().mockResolvedValue({ id: 'lead-1', ownerPositionId: null, stage: 'new' });
    const controller = new LeadController(
      { createLead } as unknown as CrmService,
      { matchingScopes: jest.fn() } as unknown as PolicyEvaluatorService,
      noReplay(),
    );
    const req = makeRequest(organizationId, positionId);

    const result = await controller.createLead(req as never, {
      contactId: contactId.toString(),
      requesterName: 'Игнорируется, если есть contactId',
    }, 'key-1');

    expect(createLead).toHaveBeenCalledWith({
      organizationId,
      contactId,
      requesterName: 'Игнорируется, если есть contactId',
      requesterPhone: undefined,
      actorPositionId: positionId,
      actorIdentityId: new Types.ObjectId(req.tenantContext.identityId),
      correlationId: undefined,
      idempotencyKey: 'key-1',
      idempotencyRequestBody: {
        contactId: contactId.toString(),
        requesterName: 'Игнорируется, если есть contactId',
        requesterPhone: null,
      },
    });
    expect(result).toEqual({ id: 'lead-1', ownerPositionId: null, stage: 'new' });
  });

  it('без contactId передаёт undefined, requesterPhone доходит до сервиса как есть', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const createLead = jest.fn().mockResolvedValue({ id: 'lead-2' });
    const controller = new LeadController(
      { createLead } as unknown as CrmService,
      { matchingScopes: jest.fn() } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.createLead(makeRequest(organizationId, positionId) as never, {
      requesterPhone: '+995500000009',
    }, 'key-2');

    expect(createLead).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: undefined, requesterPhone: '+995500000009' }),
    );
  });
});

describe('LeadController.changeStage', () => {
  it('без Idempotency-Key — IDEMPOTENCY_KEY_REQUIRED, сервис не вызывается', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const changeLeadStage = jest.fn();
    const checkReplay = jest.fn();
    const controller = new LeadController(
      { changeLeadStage } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      { checkReplay } as unknown as IdempotencyService,
    );

    await expect(
      controller.changeStage(makeRequest(organizationId, positionId) as never, leadId, {
        stage: 'contacted',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(changeLeadStage).not.toHaveBeenCalled();
    expect(checkReplay).not.toHaveBeenCalled();
  });

  it('повтор с тем же Idempotency-Key возвращает сохранённый ответ, не вызывает сервис повторно', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const changeLeadStage = jest.fn();
    const checkReplay = jest.fn().mockResolvedValue({
      responseStatus: 200,
      responseBody: { id: leadId.toString(), stage: 'contacted', version: 1 },
    });
    const controller = new LeadController(
      { changeLeadStage } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      { checkReplay } as unknown as IdempotencyService,
    );

    const result = await controller.changeStage(
      makeRequest(organizationId, positionId) as never,
      leadId,
      { stage: 'contacted', expectedVersion: 0 },
      'same-key',
    );

    expect(result).toEqual({ id: leadId.toString(), stage: 'contacted', version: 1 });
    expect(changeLeadStage).not.toHaveBeenCalled();
  });

  it('пробрасывает leadId/stage/expectedVersion + actor/organization из tenantContext, с idempotencyKey', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const changeLeadStage = jest.fn().mockResolvedValue({ id: leadId.toString(), stage: 'contacted', version: 1 });
    const controller = new LeadController(
      { changeLeadStage } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      { checkReplay: jest.fn().mockResolvedValue(null) } as unknown as IdempotencyService,
    );
    const req = makeRequest(organizationId, positionId);

    await controller.changeStage(
      req as never,
      leadId,
      { stage: 'contacted', expectedVersion: 0 },
      'key-1',
    );

    expect(changeLeadStage).toHaveBeenCalledWith({
      leadId,
      newStage: 'contacted',
      expectedVersion: 0,
      actorPositionId: positionId,
      actorIdentityId: new Types.ObjectId(req.tenantContext.identityId),
      expectedOrganizationId: organizationId,
      requiredOwnerPositionId: undefined,
      correlationId: undefined,
      idempotencyKey: 'key-1',
      idempotencyRequestBody: {
        leadId: leadId.toString(),
        stage: 'contacted',
        expectedVersion: 0,
      },
    });
  });

  it('пробрасывает comment в CrmService.changeLeadStage и в idempotencyRequestBody (phase 3)', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const changeLeadStage = jest.fn().mockResolvedValue({ id: leadId.toString(), stage: 'contacted', version: 1 });
    const controller = new LeadController(
      { changeLeadStage } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      { checkReplay: jest.fn().mockResolvedValue(null) } as unknown as IdempotencyService,
    );
    const req = makeRequest(organizationId, positionId);

    await controller.changeStage(
      req as never,
      leadId,
      { stage: 'contacted', expectedVersion: 0, comment: 'Клиент попросил перезвонить завтра' },
      'key-1',
    );

    expect(changeLeadStage).toHaveBeenCalledWith(
      expect.objectContaining({ comment: 'Клиент попросил перезвонить завтра' }),
    );
  });
});

describe('LeadController — read scope', () => {
  it('сужает GET /leads для own-grant до текущей Position прямо в CRM query', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const listLeads = jest.fn().mockResolvedValue({ items: [] });
    const matchingScopes = jest.fn().mockResolvedValue(['own']);
    const controller = new LeadController(
      { listLeads } as unknown as CrmService,
      { matchingScopes } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.listLeads(makeRequest(organizationId, positionId) as never, { limit: 20 });

    expect(listLeads).toHaveBeenCalledWith({
      organizationId,
      ownerPositionId: positionId,
      stage: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it('не сужает GET /leads для organization-grant', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const listLeads = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new LeadController(
      { listLeads } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.listLeads(makeRequest(organizationId, positionId) as never, { limit: 20 });

    expect(listLeads).toHaveBeenCalledWith({
      organizationId,
      ownerPositionId: undefined,
      stage: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it('own-grant: клиентский ownerPositionId, совпадающий со своей позицией, проходит без изменений', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const listLeads = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new LeadController(
      { listLeads } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.listLeads(makeRequest(organizationId, positionId) as never, {
      limit: 20,
      ownerPositionId: positionId.toString(),
    });

    expect(listLeads).toHaveBeenCalledWith({
      organizationId,
      ownerPositionId: positionId,
      stage: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it('own-grant: клиентский ownerPositionId чужой позиции отклоняется 400, не расширяет scope', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const otherPositionId = new Types.ObjectId();
    const listLeads = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new LeadController(
      { listLeads } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await expect(
      controller.listLeads(makeRequest(organizationId, positionId) as never, {
        limit: 20,
        ownerPositionId: otherPositionId.toString(),
      }),
    ).rejects.toThrow('ownerPositionId filter is outside the caller permission scope');
    expect(listLeads).not.toHaveBeenCalled();
  });

  it('organization-grant: пробрасывает cursor как ObjectId в CrmService.listLeads', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const cursor = new Types.ObjectId();
    const listLeads = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new LeadController(
      { listLeads } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.listLeads(makeRequest(organizationId, positionId) as never, {
      limit: 20,
      cursor: cursor.toString(),
    });

    expect(listLeads).toHaveBeenCalledWith({
      organizationId,
      ownerPositionId: undefined,
      stage: undefined,
      cursor,
      limit: 20,
    });
  });
});

describe('LeadController.updateLead', () => {
  it('own-scope: сужает requiredOwnerPositionId до своей Position и пробрасывает поля', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const updateLead = jest.fn().mockResolvedValue({ id: leadId.toString() });
    const controller = new LeadController(
      { updateLead } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );
    const req = makeRequest(organizationId, positionId);

    await controller.updateLead(req as never, leadId, { city: 'Тбилиси', tags: ['vip'] });

    expect(updateLead).toHaveBeenCalledWith({
      leadId,
      organizationId,
      requiredOwnerPositionId: positionId,
      actorPositionId: positionId,
      actorIdentityId: new Types.ObjectId(req.tenantContext.identityId),
      correlationId: undefined,
      city: 'Тбилиси',
      notes: undefined,
      tags: ['vip'],
      dealValue: undefined,
      budgetValue: undefined,
      budgetCurrency: undefined,
      expectedCloseDate: undefined,
      rejectionReason: undefined,
      rejectionComment: undefined,
      telegram: undefined,
      country: undefined,
      realtorStage: undefined,
      curatorStage: undefined,
      name: undefined,
      phone: undefined,
      email: undefined,
      productType: undefined,
    });
  });

  it('organization-scope: requiredOwnerPositionId не сужается (undefined)', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const updateLead = jest.fn().mockResolvedValue({ id: leadId.toString() });
    const controller = new LeadController(
      { updateLead } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.updateLead(makeRequest(organizationId, positionId) as never, leadId, {});

    expect(updateLead).toHaveBeenCalledWith(expect.objectContaining({ requiredOwnerPositionId: undefined }));
  });

  it('пробрасывает name/phone/email/productType', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const updateLead = jest.fn().mockResolvedValue({ id: leadId.toString() });
    const controller = new LeadController(
      { updateLead } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.updateLead(makeRequest(organizationId, positionId) as never, leadId, {
      name: 'Иван',
      phone: '+995500000001',
      email: null,
      productType: 'network',
    });

    expect(updateLead).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Иван', phone: '+995500000001', email: null, productType: 'network' }),
    );
  });
});

describe('LeadController — checklist/stage-notes (phase 3.1)', () => {
  it('GET /leads/:leadId/checklist — lead.read, own-scope сужается', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const getLeadChecklist = jest.fn().mockResolvedValue({ items: [], stageNotes: [] });
    const controller = new LeadController(
      { getLeadChecklist } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.getLeadChecklist(makeRequest(organizationId, positionId) as never, leadId);

    expect(getLeadChecklist).toHaveBeenCalledWith({ leadId, organizationId, ownerPositionId: positionId });
  });

  it('PATCH /leads/:leadId/checklist — пробрасывает changes из DTO', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const updateLeadChecklist = jest.fn().mockResolvedValue({ items: [], stageNotes: [] });
    const controller = new LeadController(
      { updateLeadChecklist } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );
    const req = makeRequest(organizationId, positionId);

    await controller.updateLeadChecklist(req as never, leadId, {
      changes: [{ stage: 'new', index: 0, checked: true }],
    });

    expect(updateLeadChecklist).toHaveBeenCalledWith({
      leadId,
      organizationId,
      requiredOwnerPositionId: undefined,
      changes: [{ stage: 'new', index: 0, checked: true }],
      actorPositionId: positionId,
      actorIdentityId: new Types.ObjectId(req.tenantContext.identityId),
      correlationId: undefined,
    });
  });

  it('PUT /leads/:leadId/stage-notes/:stage — известная стадия проходит до сервиса', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const setLeadStageNote = jest.fn().mockResolvedValue({ stage: 'new', text: 'x', updatedAt: '2026-01-01T00:00:00.000Z' });
    const controller = new LeadController(
      { setLeadStageNote } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.setLeadStageNote(makeRequest(organizationId, positionId) as never, leadId, 'new', { text: 'x' });

    expect(setLeadStageNote).toHaveBeenCalledWith(
      expect.objectContaining({ leadId, organizationId, stage: 'new', text: 'x' }),
    );
  });

  it('PUT /leads/:leadId/stage-notes/:stage — неизвестная стадия отклоняется до вызова сервиса', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const setLeadStageNote = jest.fn();
    const controller = new LeadController(
      { setLeadStageNote } as unknown as CrmService,
      { matchingScopes: jest.fn() } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await expect(
      controller.setLeadStageNote(makeRequest(organizationId, positionId) as never, leadId, 'not_a_real_stage', { text: 'x' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(setLeadStageNote).not.toHaveBeenCalled();
  });
});

describe('LeadController.deleteLead', () => {
  it('пробрасывает leadId/actor/organization в CrmService.deleteLead', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const deleteLead = jest.fn().mockResolvedValue({ deleted: true });
    const controller = new LeadController(
      { deleteLead } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );
    const req = makeRequest(organizationId, positionId);

    const result = await controller.deleteLead(req as never, leadId);

    expect(deleteLead).toHaveBeenCalledWith({
      leadId,
      organizationId,
      requiredOwnerPositionId: undefined,
      actorPositionId: positionId,
      actorIdentityId: new Types.ObjectId(req.tenantContext.identityId),
      correlationId: undefined,
    });
    expect(result).toEqual({ deleted: true });
  });
});

describe('LeadController — файлы лида (phase 3)', () => {
  it('GET /leads/:leadId/files — read-scope сужение, пробрасывает leadId/organizationId', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const listLeadFiles = jest.fn().mockResolvedValue([]);
    const controller = new LeadController(
      { listLeadFiles } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.listLeadFiles(makeRequest(organizationId, positionId) as never, leadId);

    expect(listLeadFiles).toHaveBeenCalledWith({ leadId, organizationId, ownerPositionId: positionId });
  });

  it('POST /leads/:leadId/files — пробрасывает assetId/actor, использует update-scope', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const assetId = new Types.ObjectId();
    const attachLeadFile = jest.fn().mockResolvedValue([]);
    const controller = new LeadController(
      { attachLeadFile } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );
    const req = makeRequest(organizationId, positionId);

    await controller.attachLeadFile(req as never, leadId, { assetId: assetId.toString() });

    expect(attachLeadFile).toHaveBeenCalledWith({
      leadId,
      organizationId,
      ownerPositionId: undefined,
      assetId,
      actorIdentityId: new Types.ObjectId(req.tenantContext.identityId),
      correlationId: undefined,
    });
  });

  it('DELETE /leads/:leadId/files/:assetId — пробрасывает assetId из пути', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const assetId = new Types.ObjectId();
    const detachLeadFile = jest.fn().mockResolvedValue([]);
    const controller = new LeadController(
      { detachLeadFile } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );
    const req = makeRequest(organizationId, positionId);

    await controller.detachLeadFile(req as never, leadId, assetId);

    expect(detachLeadFile).toHaveBeenCalledWith({
      leadId,
      organizationId,
      ownerPositionId: positionId,
      assetId,
      actorIdentityId: new Types.ObjectId(req.tenantContext.identityId),
      correlationId: undefined,
    });
  });
});

describe('LeadController.recordContactAction', () => {
  it('пробрасывает contactType/actor/organization, использует update-scope', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const recordContactAction = jest.fn().mockResolvedValue({ recorded: true });
    const controller = new LeadController(
      { recordContactAction } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );
    const req = makeRequest(organizationId, positionId);

    const result = await controller.recordContactAction(req as never, leadId, { contactType: 'call' });

    expect(recordContactAction).toHaveBeenCalledWith({
      leadId,
      organizationId,
      ownerPositionId: positionId,
      contactType: 'call',
      actorPositionId: positionId,
      actorIdentityId: new Types.ObjectId(req.tenantContext.identityId),
      correlationId: undefined,
    });
    expect(result).toEqual({ recorded: true });
  });
});

describe('LeadController — GET /leads/:leadId/events', () => {
  it('передаёт leadId/organizationId/ownerPositionId/cursor/limit в CrmService.listLeadEvents', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const cursor = new Types.ObjectId();
    const listLeadEvents = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new LeadController(
      { listLeadEvents } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.listLeadEvents(makeRequest(organizationId, positionId) as never, leadId, {
      limit: 20,
      cursor: cursor.toString(),
    });

    expect(listLeadEvents).toHaveBeenCalledWith({
      leadId,
      organizationId,
      ownerPositionId: positionId,
      cursor,
      limit: 20,
    });
  });
});

describe('LeadController — GET /leads/:leadId/timeline', () => {
  it('передаёт параметры запроса в CrmService.getLeadTimeline с учётом own-scope', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const leadId = new Types.ObjectId();
    const getLeadTimeline = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new LeadController(
      { getLeadTimeline } as unknown as CrmService,
      { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
    );

    await controller.getLeadTimeline(makeRequest(organizationId, positionId) as never, leadId, {
      type: 'lead_stage_changed',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.999Z',
      cursor: 'cursor-123',
      limit: 10,
    });

    expect(getLeadTimeline).toHaveBeenCalledWith({
      leadId,
      organizationId,
      ownerPositionId: positionId,
      type: 'lead_stage_changed',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.999Z',
      cursor: 'cursor-123',
      limit: 10,
    });
  });
});
