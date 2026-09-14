import { Types } from 'mongoose';
import { ContactRepository } from './contact.repository';

describe('ContactRepository.findByPhone', () => {
  /**
   * domain-model.md Module 7 invariant: tenant-local dedupe — organizationId
   * ОБЯЗАТЕЛЬНО в фильтре, не только phone. Без него dedupe утекал бы через
   * границу организации (чужой Contact с тем же номером считался бы найденным).
   */
  it('фильтр включает organizationId И phone, не только phone', async () => {
    const organizationId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue(null);
    const findOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new ContactRepository({ findOne: findOneSpy } as never);

    await repository.findByPhone(organizationId, '+79997654321');

    expect(findOneSpy).toHaveBeenCalledWith({ organizationId, phone: '+79997654321' });
  });
});

describe('ContactRepository.findByIdForOrganizationScoped', () => {
  it('без contactIds (organization-scope) — фильтр только _id+organizationId', async () => {
    const id = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue(null);
    const findOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new ContactRepository({ findOne: findOneSpy } as never);

    await repository.findByIdForOrganizationScoped(id, organizationId);

    expect(findOneSpy).toHaveBeenCalledWith({ _id: id, organizationId });
  });

  it('own-scope: id входит в contactIds — читает документ', async () => {
    const id = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue({ _id: id });
    const findOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new ContactRepository({ findOne: findOneSpy } as never);

    const result = await repository.findByIdForOrganizationScoped(id, organizationId, [id, new Types.ObjectId()]);

    expect(result).toEqual({ _id: id });
    expect(findOneSpy).toHaveBeenCalledWith({ _id: id, organizationId });
  });

  it('own-scope: id НЕ входит в contactIds — null без похода в базу (findOne не вызывается)', async () => {
    const id = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const findOneSpy = jest.fn();
    const repository = new ContactRepository({ findOne: findOneSpy } as never);

    const result = await repository.findByIdForOrganizationScoped(id, organizationId, [new Types.ObjectId()]);

    expect(result).toBeNull();
    expect(findOneSpy).not.toHaveBeenCalled();
  });
});

describe('ContactRepository.updateFields', () => {
  it('фильтр включает _id И organizationId', async () => {
    const id = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new ContactRepository({ updateOne: updateOneSpy } as never);

    await repository.updateFields(id, organizationId, { name: 'Пётр' });

    expect(updateOneSpy).toHaveBeenCalledWith({ _id: id, organizationId }, { $set: { name: 'Пётр' } }, { session: undefined });
  });

  it('только переданные поля попадают в $set', async () => {
    const id = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new ContactRepository({ updateOne: updateOneSpy } as never);

    await repository.updateFields(id, organizationId, { phone: '+995500000009' });

    expect(updateOneSpy).toHaveBeenCalledWith({ _id: id, organizationId }, { $set: { phone: '+995500000009' } }, { session: undefined });
  });

  it('email: null — $unset, не $set', async () => {
    const id = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new ContactRepository({ updateOne: updateOneSpy } as never);

    await repository.updateFields(id, organizationId, { email: null });

    expect(updateOneSpy).toHaveBeenCalledWith({ _id: id, organizationId }, { $unset: { email: '' } }, { session: undefined });
  });

  it('email и name вместе — $set для name, $unset для email в одном вызове', async () => {
    const id = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const updateOneSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const repository = new ContactRepository({ updateOne: updateOneSpy } as never);

    await repository.updateFields(id, organizationId, { name: 'Пётр', email: null });

    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: id, organizationId },
      { $set: { name: 'Пётр' }, $unset: { email: '' } },
      { session: undefined },
    );
  });
});

describe('ContactRepository.listForOrganization', () => {
  it('без contactIds/q/cursor — фильтр только organizationId', async () => {
    const organizationId = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue([]);
    const limitSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const sortSpy = jest.fn().mockReturnValue({ limit: limitSpy });
    const findSpy = jest.fn().mockReturnValue({ sort: sortSpy });
    const repository = new ContactRepository({ find: findSpy } as never);

    await repository.listForOrganization(organizationId, { limit: 21 });

    expect(findSpy).toHaveBeenCalledWith({ organizationId });
    expect(sortSpy).toHaveBeenCalledWith({ _id: -1 });
    expect(limitSpy).toHaveBeenCalledWith(21);
  });

  it('contactIds (own-scope) — фильтр включает _id: {$in: contactIds}', async () => {
    const organizationId = new Types.ObjectId();
    const contactIds = [new Types.ObjectId(), new Types.ObjectId()];
    const execSpy = jest.fn().mockResolvedValue([]);
    const limitSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const sortSpy = jest.fn().mockReturnValue({ limit: limitSpy });
    const findSpy = jest.fn().mockReturnValue({ sort: sortSpy });
    const repository = new ContactRepository({ find: findSpy } as never);

    await repository.listForOrganization(organizationId, { contactIds, limit: 21 });

    expect(findSpy).toHaveBeenCalledWith({ organizationId, _id: { $in: contactIds } });
  });

  it('contactIds:[] (own-scope без единого своего лида) — [] без похода в базу', async () => {
    const organizationId = new Types.ObjectId();
    const findSpy = jest.fn();
    const repository = new ContactRepository({ find: findSpy } as never);

    const result = await repository.listForOrganization(organizationId, { contactIds: [], limit: 21 });

    expect(result).toEqual([]);
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('q — фильтр включает $or по name/phone', async () => {
    const organizationId = new Types.ObjectId();
    const q = /ivan/i;
    const execSpy = jest.fn().mockResolvedValue([]);
    const limitSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const sortSpy = jest.fn().mockReturnValue({ limit: limitSpy });
    const findSpy = jest.fn().mockReturnValue({ sort: sortSpy });
    const repository = new ContactRepository({ find: findSpy } as never);

    await repository.listForOrganization(organizationId, { q, limit: 21 });

    expect(findSpy).toHaveBeenCalledWith({ organizationId, $or: [{ name: q }, { phone: q }] });
  });

  it('cursor вместе с contactIds — _id включает И $in, И $lt', async () => {
    const organizationId = new Types.ObjectId();
    const contactIds = [new Types.ObjectId()];
    const cursor = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue([]);
    const limitSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const sortSpy = jest.fn().mockReturnValue({ limit: limitSpy });
    const findSpy = jest.fn().mockReturnValue({ sort: sortSpy });
    const repository = new ContactRepository({ find: findSpy } as never);

    await repository.listForOrganization(organizationId, { contactIds, cursor, limit: 21 });

    expect(findSpy).toHaveBeenCalledWith({
      organizationId,
      _id: { $in: contactIds, $lt: cursor },
    });
  });

  it('cursor без contactIds — _id: {$lt: cursor}', async () => {
    const organizationId = new Types.ObjectId();
    const cursor = new Types.ObjectId();
    const execSpy = jest.fn().mockResolvedValue([]);
    const limitSpy = jest.fn().mockReturnValue({ exec: execSpy });
    const sortSpy = jest.fn().mockReturnValue({ limit: limitSpy });
    const findSpy = jest.fn().mockReturnValue({ sort: sortSpy });
    const repository = new ContactRepository({ find: findSpy } as never);

    await repository.listForOrganization(organizationId, { cursor, limit: 21 });

    expect(findSpy).toHaveBeenCalledWith({ organizationId, _id: { $lt: cursor } });
  });
});
