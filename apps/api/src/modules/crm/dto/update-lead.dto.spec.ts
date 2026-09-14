import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateLeadDto } from './update-lead.dto';

/**
 * `name`/`phone`/`email`/`productType` — Contact-поля + смена продукта,
 * добавлены поверх сопутствующих полей лида (см. UpdateLeadDto докстринг).
 * Те же опции ValidationPipe, что reveal-contact.dto.spec.ts.
 */
describe('UpdateLeadDto — name/phone/email/productType', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };

  it('пустой объект — валиден (все поля опциональны)', async () => {
    const instance = plainToInstance(UpdateLeadDto, {});
    const errors = await validate(instance, options);
    expect(errors).toHaveLength(0);
  });

  it('валидные name/phone/email/productType проходят', async () => {
    const instance = plainToInstance(UpdateLeadDto, {
      name: 'Иван Иванов',
      phone: '+995500000001',
      email: 'ivan@example.test',
      productType: 'network',
    });
    const errors = await validate(instance, options);
    expect(errors).toHaveLength(0);
  });

  it('email: null проходит (явная очистка поля)', async () => {
    const instance = plainToInstance(UpdateLeadDto, { email: null });
    const errors = await validate(instance, options);
    expect(errors).toHaveLength(0);
  });

  it('некорректный email отклоняется', async () => {
    const instance = plainToInstance(UpdateLeadDto, { email: 'not-an-email' });
    const errors = await validate(instance, options);
    expect(errors.find((e) => e.property === 'email')).toBeDefined();
  });

  it('productType вне PRODUCT_TYPES отклоняется', async () => {
    const instance = plainToInstance(UpdateLeadDto, { productType: 'invalid' });
    const errors = await validate(instance, options);
    expect(errors.find((e) => e.property === 'productType')).toBeDefined();
  });

  it('name длиннее 200 символов отклоняется', async () => {
    const instance = plainToInstance(UpdateLeadDto, { name: 'a'.repeat(201) });
    const errors = await validate(instance, options);
    expect(errors.find((e) => e.property === 'name')).toBeDefined();
  });

  it('phone длиннее 30 символов отклоняется', async () => {
    const instance = plainToInstance(UpdateLeadDto, { phone: '1'.repeat(31) });
    const errors = await validate(instance, options);
    expect(errors.find((e) => e.property === 'phone')).toBeDefined();
  });

  it('лишнее поле сверх whitelist отклоняется', async () => {
    const instance = plainToInstance(UpdateLeadDto, { unknownField: 'x' });
    const errors = await validate(instance, options);
    expect(errors.find((e) => e.property === 'unknownField')).toBeDefined();
  });
});
