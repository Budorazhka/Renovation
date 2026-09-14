import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateLeadChecklistDto } from './update-lead-checklist.dto';

describe('UpdateLeadChecklistDto', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };

  it('валидные changes проходят', async () => {
    const instance = plainToInstance(UpdateLeadChecklistDto, {
      changes: [
        { stage: 'new', index: 0, checked: true },
        { stage: 'contacted', index: 3, checked: false },
      ],
    });
    const errors = await validate(instance, options);
    expect(errors).toHaveLength(0);
  });

  it('пустой массив changes отклоняется (ArrayMinSize 1)', async () => {
    const instance = plainToInstance(UpdateLeadChecklistDto, { changes: [] });
    const errors = await validate(instance, options);
    expect(errors.find((e) => e.property === 'changes')).toBeDefined();
  });

  it('более 200 changes отклоняется', async () => {
    const changes = Array.from({ length: 201 }, (_, i) => ({ stage: 'new', index: i % 100, checked: true }));
    const instance = plainToInstance(UpdateLeadChecklistDto, { changes });
    const errors = await validate(instance, options);
    expect(errors.find((e) => e.property === 'changes')).toBeDefined();
  });

  it('index вне 0..100 отклоняется', async () => {
    const instance = plainToInstance(UpdateLeadChecklistDto, {
      changes: [{ stage: 'new', index: 101, checked: true }],
    });
    const errors = await validate(instance, options);
    const changeError = errors.find((e) => e.property === 'changes');
    expect(changeError?.children?.[0]?.children?.find((e) => e.property === 'index')).toBeDefined();
  });

  it('stage вне ALL_LEAD_STAGE_VALUES отклоняется', async () => {
    const instance = plainToInstance(UpdateLeadChecklistDto, {
      changes: [{ stage: 'not_a_real_stage', index: 0, checked: true }],
    });
    const errors = await validate(instance, options);
    const changeError = errors.find((e) => e.property === 'changes');
    expect(changeError?.children?.[0]?.children?.find((e) => e.property === 'stage')).toBeDefined();
  });

  it('отрицательный index отклоняется', async () => {
    const instance = plainToInstance(UpdateLeadChecklistDto, {
      changes: [{ stage: 'new', index: -1, checked: true }],
    });
    const errors = await validate(instance, options);
    const changeError = errors.find((e) => e.property === 'changes');
    expect(changeError?.children?.[0]?.children?.find((e) => e.property === 'index')).toBeDefined();
  });
});
