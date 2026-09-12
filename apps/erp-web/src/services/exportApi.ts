import axios from 'axios';
import { PLATFORM_API_BASE_URL } from '@/config/backend';

export type ExportEntity = 'leads' | 'deals' | 'contacts' | 'tasks';

const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  withCredentials: true,
  responseType: 'blob',
});

export const exportApi = {
  /**
   * Скачивание файла реестра CRM в формате XLSX
   * GET /api/v1/exports/{entity}
   */
  async downloadExport(entity: ExportEntity): Promise<void> {
    const response = await api.get(`/api/v1/exports/${entity}`);

    // Извлекаем имя файла из заголовка Content-Disposition (RFC 5987 filename* или обычный filename)
    let fileName = `${entity}_export.xlsx`;
    const disposition = response.headers['content-disposition'] as string | undefined;
    if (disposition) {
      const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      if (utf8Match?.[1]) {
        fileName = decodeURIComponent(utf8Match[1]);
      } else {
        const standardMatch = disposition.match(/filename="?([^";]+)"?/i);
        if (standardMatch?.[1]) {
          fileName = standardMatch[1];
        }
      }
    }

    const blob = new Blob([response.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },
};
