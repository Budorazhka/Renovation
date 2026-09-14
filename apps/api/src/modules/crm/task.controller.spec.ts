import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TaskController } from './task.controller';
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
    correlationId: 'req-corr-123',
  };
}

describe('TaskController', () => {
  describe('listTasks', () => {
    it('scopes query to assignedPositionId for own-grant', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const listTasks = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
      const matchingScopes = jest.fn().mockResolvedValue(['own']);
      const controller = new TaskController(
        { listTasks } as unknown as CrmService,
        { matchingScopes } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      await controller.listTasks(makeRequest(organizationId, positionId) as never, { limit: 20 });

      expect(listTasks).toHaveBeenCalledWith({
        organizationId,
        assignedPositionId: positionId,
        callerPositionId: positionId,
        leadId: undefined,
        contactId: undefined,
        status: undefined,
        dueBefore: undefined,
        dueAfter: undefined,
        cursor: undefined,
        limit: 20,
      });
    });

    it('does not scope query to position for organization-grant', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const listTasks = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
      const matchingScopes = jest.fn().mockResolvedValue(['organization']);
      const controller = new TaskController(
        { listTasks } as unknown as CrmService,
        { matchingScopes } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      await controller.listTasks(makeRequest(organizationId, positionId) as never, { limit: 20 });

      expect(listTasks).toHaveBeenCalledWith({
        organizationId,
        assignedPositionId: undefined,
        callerPositionId: positionId,
        leadId: undefined,
        contactId: undefined,
        status: undefined,
        dueBefore: undefined,
        dueAfter: undefined,
        cursor: undefined,
        limit: 20,
      });
    });

    it('throws BadRequestException if own-grant user requests tasks of another position', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const otherPositionId = new Types.ObjectId();
      const controller = new TaskController(
        { listTasks: jest.fn() } as unknown as CrmService,
        { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      await expect(
        controller.listTasks(makeRequest(organizationId, positionId) as never, {
          assignedPositionId: otherPositionId.toString(),
          limit: 20,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTask', () => {
    it('passes resolved owner position filter to getTask', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const taskId = new Types.ObjectId();
      const getTask = jest.fn().mockResolvedValue({ id: taskId.toString() });
      const controller = new TaskController(
        { getTask } as unknown as CrmService,
        { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      await controller.getTask(makeRequest(organizationId, positionId) as never, taskId);

      expect(getTask).toHaveBeenCalledWith({
        taskId,
        organizationId,
        assignedPositionId: positionId,
        callerPositionId: positionId,
      });
    });
  });

  describe('downloadAttachment', () => {
    it('passes resolved owner position filter to getTaskAttachmentDownloadUrl, same as getTask', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const taskId = new Types.ObjectId();
      const assetId = new Types.ObjectId();
      const getTaskAttachmentDownloadUrl = jest
        .fn()
        .mockResolvedValue({ url: 'https://minio.local/signed', fileName: 'contract.pdf' });
      const controller = new TaskController(
        { getTaskAttachmentDownloadUrl } as unknown as CrmService,
        { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      const result = await controller.downloadAttachment(
        makeRequest(organizationId, positionId) as never,
        taskId,
        assetId,
      );

      expect(getTaskAttachmentDownloadUrl).toHaveBeenCalledWith({
        taskId,
        assetId,
        organizationId,
        assignedPositionId: positionId,
        callerPositionId: positionId,
      });
      expect(result).toEqual({ url: 'https://minio.local/signed', fileName: 'contract.pdf' });
    });

    it('does not scope query to position for organization-grant', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const taskId = new Types.ObjectId();
      const assetId = new Types.ObjectId();
      const getTaskAttachmentDownloadUrl = jest
        .fn()
        .mockResolvedValue({ url: 'https://minio.local/signed', fileName: 'contract.pdf' });
      const controller = new TaskController(
        { getTaskAttachmentDownloadUrl } as unknown as CrmService,
        { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      await controller.downloadAttachment(makeRequest(organizationId, positionId) as never, taskId, assetId);

      expect(getTaskAttachmentDownloadUrl).toHaveBeenCalledWith({
        taskId,
        assetId,
        organizationId,
        assignedPositionId: undefined,
        callerPositionId: positionId,
      });
    });
  });

  describe('createTask', () => {
    it('passes requiredScopePositionId for own-grant user', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const createTask = jest.fn().mockResolvedValue({ id: 'task-1' });
      const controller = new TaskController(
        { createTask } as unknown as CrmService,
        { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      await controller.createTask(makeRequest(organizationId, positionId) as never, {
        title: 'Follow up',
      }, 'test-key');

      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId,
          actorPositionId: positionId,
          requiredScopePositionId: positionId,
          title: 'Follow up',
          correlationId: 'req-corr-123',
          // ИСПРАВЛЕНО 11.09.2026: своё имя операции идемпотентности —
          // messenger create-task-from-dialog передаёт 'createTaskFromDialog',
          // иначе общий Idempotency-Key на двух эндпоинтах давал ложный 409.
          idempotencyOperation: 'createTask',
        }),
      );
    });
  });

  describe('updateTask', () => {
    it('пробрасывает expectedVersion, НЕ передаёт assignedPositionId (task.reassign отдельно)', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const taskId = new Types.ObjectId();
      const updateTask = jest.fn().mockResolvedValue({ id: taskId.toString() });
      const controller = new TaskController(
        { updateTask } as unknown as CrmService,
        { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      await controller.updateTask(makeRequest(organizationId, positionId) as never, taskId, {
        expectedVersion: 2,
        title: 'Новое название',
      });

      expect(updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId,
          organizationId,
          expectedVersion: 2,
          title: 'Новое название',
          requiredScopePositionId: undefined,
        }),
      );
      expect(updateTask.mock.calls[0]![0]).not.toHaveProperty('assignedPositionId');
    });

    it('конвертирует leadId/attachments в ObjectId, null снимает dueAt/startAt/leadId/colorHex', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const taskId = new Types.ObjectId();
      const leadId = new Types.ObjectId();
      const assetId = new Types.ObjectId();
      const updateTask = jest.fn().mockResolvedValue({ id: taskId.toString() });
      const controller = new TaskController(
        { updateTask } as unknown as CrmService,
        { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      await controller.updateTask(makeRequest(organizationId, positionId) as never, taskId, {
        expectedVersion: 2,
        dueAt: null,
        startAt: null,
        colorHex: null,
        leadId: leadId.toString(),
        isUrgent: true,
        isImportant: false,
        taskCategory: 'personal',
        taskType: 'call',
        attachments: [{ assetId: assetId.toString(), fileName: 'contract.pdf' }],
      });

      expect(updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId,
          organizationId,
          expectedVersion: 2,
          dueAt: null,
          startAt: null,
          colorHex: null,
          leadId,
          isUrgent: true,
          isImportant: false,
          taskCategory: 'personal',
          taskType: 'call',
          attachments: [{ assetId, fileName: 'contract.pdf' }],
        }),
      );
    });

    it('leadId не передан — leadId в вызове сервиса undefined (поле не трогается)', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const taskId = new Types.ObjectId();
      const updateTask = jest.fn().mockResolvedValue({ id: taskId.toString() });
      const controller = new TaskController(
        { updateTask } as unknown as CrmService,
        { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      await controller.updateTask(makeRequest(organizationId, positionId) as never, taskId, {
        expectedVersion: 2,
        title: 'x',
      });

      expect(updateTask.mock.calls[0]![0].leadId).toBeUndefined();
      expect(updateTask.mock.calls[0]![0].attachments).toBeUndefined();
    });
  });

  describe('reassignTask', () => {
    it('own-grant: requiredScopePositionId передаётся, assignedPositionId сконвертирован в ObjectId', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const taskId = new Types.ObjectId();
      const reassignTask = jest.fn().mockResolvedValue({ id: taskId.toString() });
      const controller = new TaskController(
        { reassignTask } as unknown as CrmService,
        { matchingScopes: jest.fn().mockResolvedValue(['own']) } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      await controller.reassignTask(makeRequest(organizationId, positionId) as never, taskId, {
        expectedVersion: 1,
        assignedPositionId: positionId.toString(),
      });

      expect(reassignTask).toHaveBeenCalledWith({
        taskId,
        organizationId,
        actorPositionId: positionId,
        actorIdentityId: expect.any(Types.ObjectId),
        requiredScopePositionId: positionId,
        expectedVersion: 1,
        assignedPositionId: positionId,
        correlationId: 'req-corr-123',
      });
    });

    it('отсутствие assignedPositionId — передаёт null (снятие назначения)', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const taskId = new Types.ObjectId();
      const reassignTask = jest.fn().mockResolvedValue({ id: taskId.toString() });
      const controller = new TaskController(
        { reassignTask } as unknown as CrmService,
        { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      await controller.reassignTask(makeRequest(organizationId, positionId) as never, taskId, {
        expectedVersion: 1,
      });

      expect(reassignTask).toHaveBeenCalledWith(
        expect.objectContaining({ assignedPositionId: null, requiredScopePositionId: undefined }),
      );
    });
  });

  describe('completeTask', () => {
    it('invokes crmService.completeTask with tenant, position context and expectedVersion', async () => {
      const organizationId = new Types.ObjectId();
      const positionId = new Types.ObjectId();
      const taskId = new Types.ObjectId();
      const completeTask = jest.fn().mockResolvedValue({ id: taskId.toString(), status: 'completed' });
      const controller = new TaskController(
        { completeTask } as unknown as CrmService,
        { matchingScopes: jest.fn().mockResolvedValue(['organization']) } as unknown as PolicyEvaluatorService,
      noReplay(),
      );

      await controller.completeTask(makeRequest(organizationId, positionId) as never, taskId, {
        expectedVersion: 3,
      });

      expect(completeTask).toHaveBeenCalledWith({
        taskId,
        organizationId,
        actorPositionId: positionId,
        actorIdentityId: expect.any(Types.ObjectId),
        requiredScopePositionId: undefined,
        expectedVersion: 3,
        correlationId: 'req-corr-123',
      });
    });
  });
});
