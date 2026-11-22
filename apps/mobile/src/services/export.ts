/**
 * "Export my records" (/v1/me/export, staff Me): one CSV of the worker's own
 * debriefs, cases, completed tasks and confirmed referral outcomes, with a
 * summary at the top. On a phone it's written to the cache and handed to the
 * share sheet (save to Files, email it); on the web it downloads.
 */
import { useMutation } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { request } from '@/api/client';
import type { RecordsExport } from '@/api/types';

export const exportApi = {
  mine: () => request<RecordsExport>('/me/export'),
};

/** Hands the CSV to the person: a browser download on the web, the share sheet on a phone. */
export async function saveCsv(filename: string, csv: string): Promise<'downloaded' | 'shared'> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return 'downloaded';
  }
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  await file.write(csv);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: filename });
  return 'shared';
}

/** Fetch my records and save them; resolves with the export (its summary) once handed off. */
export function useExportMyRecords() {
  return useMutation({
    mutationFn: async () => {
      const data = await exportApi.mine();
      const how = await saveCsv(data.filename, data.csv);
      return { ...data, how };
    },
  });
}
