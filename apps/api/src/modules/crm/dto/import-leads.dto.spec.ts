import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ImportLeadsQueryDto } from './import-leads.dto';

describe('ImportLeadsQueryDto', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };

  it('без tag — валиден (опционален)', async () => {
    const instance = plainToInstance(ImportLeadsQueryDto, {});
    const errors = await validate(instance, options);
    expect(errors).toHaveLength(0);
  });

  it('tag=old_base — валиден', async () => {
    const instance = plainToInstance(ImportLeadsQueryDto, { tag: 'old_base' });
    const errors = await validate(instance, options);
    expect(errors).toHaveLength(0);
  });

  it('любое другое значение tag — отклоняется', async () => {
    const instance = plainToInstance(ImportLeadsQueryDto, { tag: 'anything_else' });
    const errors = await validate(instance, options);
    expect(errors.find((e) => e.property === 'tag')).toBeDefined();
  });
});
