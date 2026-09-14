import { Readable } from 'node:stream';
import { Workbook, type CellValue } from 'exceljs';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';

/**
 * Разбор CSV/XLSX для POST /leads/import — exceljs, та же библиотека, что
 * уже используется для сборки выгрузок (shared/xlsx/build-workbook.ts), не
 * тянем вторую зависимость под противоположное направление (чтение вместо
 * записи).
 *
 * `row` — 1-indexed номер строки ДАННЫХ (первая строка после заголовка —
 * row:1), не номер строки в самом файле: заголовок и полностью пустые
 * строки (частый case — висящий перевод строки в конце CSV) в счёт не
 * идут, иначе номер в отчёте об ошибках был бы бесполезен без ручного
 * подсчёта строк файла человеком.
 */
export interface ParsedLeadImportRow {
  row: number;
  name?: string;
  phone?: string;
  /** `[legacy-base-import]` — сырое значение колонки `whatsapp`, без обработки. */
  whatsapp?: string;
  /** `[legacy-base-import]` — сырое значение колонки `telegram`. */
  telegram?: string;
  /** `[legacy-base-import]` — сырое значение колонки `comment` (кладётся в Lead.notes). */
  comment?: string;
  /** `[legacy-base-import]` — сырое значение колонки `last_contact`, НЕ распарсено здесь (см. `parseImportContactDate`) — дата разбирается на уровне строки в LeadImportService, чтобы невалидная дата была ошибкой ЭТОЙ строки, а не всего файла. */
  lastContactAt?: string;
}

const REQUIRED_HEADER = 'phone';
const OPTIONAL_HEADER = 'name';

function detectFileKind(fileName: string, mimetype: string | undefined): 'csv' | 'xlsx' {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.csv')) return 'csv';
  if (lowerName.endsWith('.xlsx')) return 'xlsx';
  // Расширение приоритетнее mimetype — браузеры/клиенты нередко присылают
  // generic 'application/octet-stream' для CSV. mimetype — запасной вариант,
  // когда расширение не даёт ответа (например, файл без расширения вовсе).
  if (mimetype === 'text/csv' || mimetype === 'application/vnd.ms-excel') return 'csv';
  if (mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  throw new AppException(
    ErrorCode.VALIDATION_FAILED,
    'Не удалось определить формат файла — поддерживаются только .csv и .xlsx',
  );
}

/**
 * exceljs CSV-парсер по умолчанию угадывает тип каждого значения
 * (`Number(datum)`) и превращает телефон вида "+995500000001" в число
 * 995500000001, теряя знак "+" безвозвратно. `map` здесь возвращает сырую
 * строку как есть (null только для пустой ячейки) — нам не нужны числа,
 * даты или булевы значения, только текст двух колонок.
 */
function csvMap(datum: string): string | null {
  return datum === '' ? null : datum;
}

function cellToString(value: CellValue): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' && 'richText' in value) {
    const text = value.richText.map((fragment) => fragment.text).join('');
    return text.trim() === '' ? undefined : text.trim();
  }
  if (typeof value === 'object' && 'result' in value) {
    return cellToString(value.result as CellValue);
  }
  return undefined;
}

export async function parseLeadImportFile(
  buffer: Buffer,
  fileName: string,
  mimetype: string | undefined,
): Promise<ParsedLeadImportRow[]> {
  const kind = detectFileKind(fileName, mimetype);
  const workbook = new Workbook();

  if (kind === 'csv') {
    await workbook.csv.read(Readable.from(buffer), { map: csvMap });
  } else {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) {
    throw new AppException(ErrorCode.VALIDATION_FAILED, 'Файл пуст: не найдено ни одной строки');
  }

  const columnIndex = new Map<string, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = String(cell.value ?? '').trim().toLowerCase();
    if (header) columnIndex.set(header, colNumber);
  });

  const phoneColumn = columnIndex.get(REQUIRED_HEADER);
  if (!phoneColumn) {
    throw new AppException(
      ErrorCode.VALIDATION_FAILED,
      `Не найдена обязательная колонка "${REQUIRED_HEADER}" в заголовке файла`,
    );
  }
  const nameColumn = columnIndex.get(OPTIONAL_HEADER);
  const whatsappColumn = columnIndex.get('whatsapp');
  const telegramColumn = columnIndex.get('telegram');
  const commentColumn = columnIndex.get('comment');
  const lastContactColumn = columnIndex.get('last_contact');

  const rows: ParsedLeadImportRow[] = [];
  for (let excelRowNumber = 2; excelRowNumber <= sheet.rowCount; excelRowNumber += 1) {
    const excelRow = sheet.getRow(excelRowNumber);
    if (excelRow.actualCellCount === 0) continue;

    rows.push({
      row: rows.length + 1,
      name: nameColumn ? cellToString(excelRow.getCell(nameColumn).value) : undefined,
      phone: cellToString(excelRow.getCell(phoneColumn).value),
      whatsapp: whatsappColumn ? cellToString(excelRow.getCell(whatsappColumn).value) : undefined,
      telegram: telegramColumn ? cellToString(excelRow.getCell(telegramColumn).value) : undefined,
      comment: commentColumn ? cellToString(excelRow.getCell(commentColumn).value) : undefined,
      lastContactAt: lastContactColumn ? cellToString(excelRow.getCell(lastContactColumn).value) : undefined,
    });
  }

  return rows;
}

/**
 * `last_contact` колонка импорта — принимает ISO (`YYYY-MM-DD` либо полный
 * datetime, в т.ч. уже конвертированный из xlsx-даты через `cellToString`
 * выше) и легаси `dd.mm.yyyy`. Невалидная дата — ошибка ЭТОЙ строки (кидает
 * `AppException`, пойманное в LeadImportService.importRow try/catch), не
 * всего файла — тот же принцип, что пустой `phone`.
 */
export function parseImportContactDate(raw: string): Date {
  if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const dmy = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    // Круговая проверка компонентов ловит невозможные даты вроде 31.02.2026
    // — `Date.UTC` их молча "перекатывает" на следующий месяц.
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return date;
    }
  }

  throw new AppException(ErrorCode.VALIDATION_FAILED, `Некорректная дата last_contact: "${raw}" (ожидается ISO или dd.mm.yyyy)`);
}
