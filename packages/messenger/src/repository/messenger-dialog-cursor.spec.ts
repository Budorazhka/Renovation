import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { decodeDialogListCursor, encodeDialogListCursor } from './messenger-dialog.repository';

/**
 * ИСПРАВЛЕНО 11.09.2026: сортировка списка диалогов — pinned, затем свежесть
 * последнего сообщения, затем _id — а курсор фильтровал только по _id.
 * Диалог поднимается в списке при новом сообщении независимо от даты
 * создания, так что порядок по _id и порядок по сортировке расходятся не в
 * редких случаях, а почти всегда — курсор либо терял диалоги, либо
 * дублировал их. Round-trip кодека проверяется здесь (чистые функции, без
 * Mongo); что построенный по курсору Mongo-запрос действительно не теряет
 * и не дублирует диалоги — доказано на настоящей MongoDB, см.
 * apps/api/test/integration/messenger-dialogs-pagination.integration-spec.ts.
 */
describe('encodeDialogListCursor / decodeDialogListCursor', () => {
  it('round-trip: закреплённый диалог с реальным lastMessage', () => {
    const id = new Types.ObjectId();
    const sentAt = new Date('2026-09-10T12:00:00.000Z');
    const cursor = encodeDialogListCursor({ _id: id, pinned: true, lastMessage: { text: 'hi', sentAt, fromMe: false, author: 'client' } });

    const decoded = decodeDialogListCursor(cursor);

    expect(decoded).toEqual({ kind: 'seek', pinned: true, lastMessageSentAt: sentAt, id });
  });

  it('round-trip: незакреплённый диалог без единого сообщения', () => {
    const id = new Types.ObjectId();
    const cursor = encodeDialogListCursor({ _id: id, pinned: false, lastMessage: undefined });

    const decoded = decodeDialogListCursor(cursor);

    expect(decoded).toEqual({ kind: 'seek', pinned: false, lastMessageSentAt: null, id });
  });

  it('legacy: голый ObjectId принимается как обратная совместимость (см. Cursor в OpenAPI)', () => {
    const id = new Types.ObjectId();

    const decoded = decodeDialogListCursor(id.toString());

    expect(decoded).toEqual({ kind: 'legacy', id });
  });

  it('мусорная строка — не base64/JSON и не ObjectId — 400, а не молчаливое "с начала"', () => {
    expect(() => decodeDialogListCursor('not-a-cursor-at-all')).toThrow(BadRequestException);
  });

  it('валидный base64/JSON, но не той формы (нет id) — 400', () => {
    const garbage = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');

    expect(() => decodeDialogListCursor(garbage)).toThrow(BadRequestException);
  });
});
