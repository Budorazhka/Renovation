import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { UpdateTaskDto } from './update-task.dto';

// Те же опции, что глобальный ValidationPipe (main.api.ts) передаёт в
// validate() под капотом (whitelist+forbidNonWhitelisted).
const options = { whitelist: true, forbidNonWhitelisted: true };

describe('UpdateTaskDto', () => {
  it('только expectedVersion — валидация проходит (все остальные поля опциональны)', async () => {
    const instance = plainToInstance(UpdateTaskDto, { expectedVersion: 0 });

    const errors = await validate(instance, options);

    expect(errors).toHaveLength(0);
  });

  it('dueAt/startAt/colorHex/leadId — null разрешён, снимает значение', async () => {
    const instance = plainToInstance(UpdateTaskDto, {
      expectedVersion: 0,
      dueAt: null,
      startAt: null,
      colorHex: null,
      leadId: null,
    });

    const errors = await validate(instance, options);

    expect(errors).toHaveLength(0);
  });

  it('dueAt/startAt — валидная ISO-строка проходит', async () => {
    const instance = plainToInstance(UpdateTaskDto, {
      expectedVersion: 0,
      dueAt: '2026-09-20T10:00:00.000Z',
      startAt: '2026-09-19T10:00:00.000Z',
    });

    const errors = await validate(instance, options);

    expect(errors).toHaveLength(0);
  });

  it('dueAt — мусорная строка отклоняется', async () => {
    const instance = plainToInstance(UpdateTaskDto, { expectedVersion: 0, dueAt: 'not-a-date' });

    const errors = await validate(instance, options);

    expect(errors.find((e) => e.property === 'dueAt')).toBeDefined();
  });

  it('colorHex — не hex-строка отклоняется', async () => {
    const instance = plainToInstance(UpdateTaskDto, { expectedVersion: 0, colorHex: 'red' });

    const errors = await validate(instance, options);

    expect(errors.find((e) => e.property === 'colorHex')).toBeDefined();
  });

  it('colorHex — валидный #rrggbb проходит', async () => {
    const instance = plainToInstance(UpdateTaskDto, { expectedVersion: 0, colorHex: '#ff00aa' });

    const errors = await validate(instance, options);

    expect(errors).toHaveLength(0);
  });

  it('leadId — не mongoId отклоняется', async () => {
    const instance = plainToInstance(UpdateTaskDto, { expectedVersion: 0, leadId: 'not-an-id' });

    const errors = await validate(instance, options);

    expect(errors.find((e) => e.property === 'leadId')).toBeDefined();
  });

  it('leadId — валидный mongoId проходит', async () => {
    const instance = plainToInstance(UpdateTaskDto, {
      expectedVersion: 0,
      leadId: new Types.ObjectId().toString(),
    });

    const errors = await validate(instance, options);

    expect(errors).toHaveLength(0);
  });

  it('taskType — валидные значения проходят, невалидные отклоняются', async () => {
    const valid = plainToInstance(UpdateTaskDto, { expectedVersion: 0, taskType: 'call' });
    const invalid = plainToInstance(UpdateTaskDto, { expectedVersion: 0, taskType: 'video' });

    expect(await validate(valid, options)).toHaveLength(0);
    const errors = await validate(invalid, options);
    expect(errors.find((e) => e.property === 'taskType')).toBeDefined();
  });

  it('taskCategory — невалидное значение отклоняется', async () => {
    const instance = plainToInstance(UpdateTaskDto, { expectedVersion: 0, taskCategory: 'archived' });

    const errors = await validate(instance, options);

    expect(errors.find((e) => e.property === 'taskCategory')).toBeDefined();
  });

  it('assignedPositionId — не белый список, отклоняется (смена исполнителя только через /reassign)', async () => {
    const instance = plainToInstance(UpdateTaskDto, {
      expectedVersion: 0,
      assignedPositionId: new Types.ObjectId().toString(),
    });

    const errors = await validate(instance, options);

    expect(errors.find((e) => e.property === 'assignedPositionId')?.constraints).toHaveProperty(
      'whitelistValidation',
    );
  });

  it('attachments — полный список валидных вложений проходит', async () => {
    const instance = plainToInstance(UpdateTaskDto, {
      expectedVersion: 0,
      attachments: [{ assetId: new Types.ObjectId().toString(), fileName: 'contract.pdf' }],
    });

    const errors = await validate(instance, options);

    expect(errors).toHaveLength(0);
  });

  it('attachments — assetId не mongoId отклоняется', async () => {
    const instance = plainToInstance(UpdateTaskDto, {
      expectedVersion: 0,
      attachments: [{ assetId: 'bad-id', fileName: 'contract.pdf' }],
    });

    const errors = await validate(instance, options);

    expect(errors.find((e) => e.property === 'attachments')).toBeDefined();
  });

  it('isUrgent/isImportant — не boolean отклоняется', async () => {
    const instance = plainToInstance(UpdateTaskDto, { expectedVersion: 0, isUrgent: 'yes' });

    const errors = await validate(instance, options);

    expect(errors.find((e) => e.property === 'isUrgent')).toBeDefined();
  });
});
