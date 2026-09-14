import { Workbook } from 'exceljs';
import { parseLeadImportFile, parseImportContactDate } from './lead-import-file-parser';

async function buildXlsx(headers: string[], rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Лиды');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('parseLeadImportFile — CSV', () => {
  it('разбирает валидный csv, колонки в любом порядке, заголовок case-insensitive', async () => {
    const csv = 'Name,Phone\nИван,+995500000001\nПётр,+995500000002\n';
    const rows = await parseLeadImportFile(Buffer.from(csv, 'utf8'), 'leads.csv', 'text/csv');

    expect(rows).toEqual([
      { row: 1, name: 'Иван', phone: '+995500000001' },
      { row: 2, name: 'Пётр', phone: '+995500000002' },
    ]);
  });

  it('порядок колонок phone,name — тоже работает (matching по имени заголовка, не позиции)', async () => {
    const csv = 'phone,name\n+995500000001,Иван\n';
    const rows = await parseLeadImportFile(Buffer.from(csv, 'utf8'), 'leads.csv', 'text/csv');

    expect(rows).toEqual([{ row: 1, name: 'Иван', phone: '+995500000001' }]);
  });

  it('колонка name необязательна', async () => {
    const csv = 'phone\n+995500000001\n';
    const rows = await parseLeadImportFile(Buffer.from(csv, 'utf8'), 'leads.csv', 'text/csv');

    expect(rows).toEqual([{ row: 1, name: undefined, phone: '+995500000001' }]);
  });

  it('телефон не превращается в число и не теряет ведущий "+"', async () => {
    const csv = 'phone\n+995500000001\n';
    const rows = await parseLeadImportFile(Buffer.from(csv, 'utf8'), 'leads.csv', 'text/csv');

    expect(rows[0]!.phone).toBe('+995500000001');
    expect(typeof rows[0]!.phone).toBe('string');
  });

  it('без обязательной колонки phone — понятная ошибка, не молчаливый пропуск строк', async () => {
    const csv = 'name\nИван\n';
    await expect(parseLeadImportFile(Buffer.from(csv, 'utf8'), 'leads.csv', 'text/csv')).rejects.toThrow(
      /phone/,
    );
  });

  it('полностью пустые строки не считаются строками данных (не ломают нумерацию)', async () => {
    const csv = 'phone,name\n+995500000001,Иван\n\n+995500000002,Пётр\n';
    const rows = await parseLeadImportFile(Buffer.from(csv, 'utf8'), 'leads.csv', 'text/csv');

    expect(rows).toEqual([
      { row: 1, name: 'Иван', phone: '+995500000001' },
      { row: 2, name: 'Пётр', phone: '+995500000002' },
    ]);
  });

  it('пустой файл — понятная ошибка', async () => {
    await expect(parseLeadImportFile(Buffer.from('', 'utf8'), 'leads.csv', 'text/csv')).rejects.toThrow(
      /пуст/,
    );
  });
});

describe('parseLeadImportFile — XLSX', () => {
  it('разбирает валидный xlsx', async () => {
    const buffer = await buildXlsx(['Phone', 'Name'], [['+995500000001', 'Иван']]);
    const rows = await parseLeadImportFile(buffer, 'leads.xlsx', undefined);

    expect(rows).toEqual([{ row: 1, name: 'Иван', phone: '+995500000001' }]);
  });

  it('неизвестное расширение и mimetype — понятная ошибка', async () => {
    await expect(
      parseLeadImportFile(Buffer.from('irrelevant'), 'leads.txt', 'text/plain'),
    ).rejects.toThrow(/формат/);
  });
});

describe('parseLeadImportFile — legacy-base-import колонки (whatsapp/telegram/comment/last_contact)', () => {
  it('разбирает все новые колонки, регистронезависимо, в любом порядке', async () => {
    const csv = 'phone,Telegram,WHATSAPP,Comment,Last_Contact\n+995500000001,@ivan,+995500000009,Старый клиент,2026-01-15\n';
    const rows = await parseLeadImportFile(Buffer.from(csv, 'utf8'), 'leads.csv', 'text/csv');

    expect(rows).toEqual([
      {
        row: 1,
        name: undefined,
        phone: '+995500000001',
        telegram: '@ivan',
        whatsapp: '+995500000009',
        comment: 'Старый клиент',
        lastContactAt: '2026-01-15',
      },
    ]);
  });

  it('без новых колонок — поля undefined, старые файлы (только phone/name) продолжают работать', async () => {
    const csv = 'phone,name\n+995500000001,Иван\n';
    const rows = await parseLeadImportFile(Buffer.from(csv, 'utf8'), 'leads.csv', 'text/csv');

    expect(rows).toEqual([{ row: 1, name: 'Иван', phone: '+995500000001' }]);
  });
});

describe('parseImportContactDate', () => {
  it('ISO-дату (YYYY-MM-DD) разбирает', () => {
    const date = parseImportContactDate('2026-01-15');
    expect(date.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('ISO datetime разбирает', () => {
    const date = parseImportContactDate('2026-01-15T10:30:00.000Z');
    expect(date.toISOString()).toBe('2026-01-15T10:30:00.000Z');
  });

  it('dd.mm.yyyy (легаси-формат) разбирает', () => {
    const date = parseImportContactDate('15.01.2026');
    expect(date.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('несуществующая дата (31.02.2026) — ошибка', () => {
    expect(() => parseImportContactDate('31.02.2026')).toThrow(/Некорректная дата/);
  });

  it('произвольный мусор — ошибка', () => {
    expect(() => parseImportContactDate('не дата вообще')).toThrow(/Некорректная дата/);
  });

  it('американский формат mm/dd/yyyy — ошибка (не входит в поддерживаемые форматы)', () => {
    expect(() => parseImportContactDate('01/15/2026')).toThrow(/Некорректная дата/);
  });
});
