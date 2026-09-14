import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetLeadStageNoteDto } from './set-lead-stage-note.dto';

describe('SetLeadStageNoteDto', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };

  it('непустой text проходит', async () => {
    const instance = plainToInstance(SetLeadStageNoteDto, { text: 'Перезвонить завтра' });
    const errors = await validate(instance, options);
    expect(errors).toHaveLength(0);
  });

  it('пустая строка проходит (удаление заметки — валидное значение)', async () => {
    const instance = plainToInstance(SetLeadStageNoteDto, { text: '' });
    const errors = await validate(instance, options);
    expect(errors).toHaveLength(0);
  });

  it('text длиннее 5000 символов отклоняется', async () => {
    const instance = plainToInstance(SetLeadStageNoteDto, { text: 'a'.repeat(5001) });
    const errors = await validate(instance, options);
    expect(errors.find((e) => e.property === 'text')).toBeDefined();
  });

  it('отсутствие text отклоняется', async () => {
    const instance = plainToInstance(SetLeadStageNoteDto, {});
    const errors = await validate(instance, options);
    expect(errors.find((e) => e.property === 'text')).toBeDefined();
  });
});
