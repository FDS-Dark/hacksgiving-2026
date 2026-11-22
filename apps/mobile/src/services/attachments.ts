/**
 * Case attachments (/v1/cases/{id}/attachments) and knowledge search
 * (/v1/knowledge/search). A file goes straight from the phone to the private
 * object store with a one-time URL; the API checks it arrived. Staff only.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryString, request } from '@/api/client';
import type { Attachment, AttachmentLink, AttachmentUpload, KnowledgeHit } from '@/api/types';
import { caseKeys } from '@/services/cases';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'];

export const attachmentsApi = {
  list: (caseId: string) => request<Attachment[]>(`/cases/${caseId}/attachments`),
  start: (caseId: string, body: { file_name: string; content_type: string; size_bytes: number; note: string }) =>
    request<AttachmentUpload>(`/cases/${caseId}/attachments`, { method: 'POST', body }),
  uploaded: (caseId: string, id: string) => request<Attachment>(`/cases/${caseId}/attachments/${id}/uploaded`, { method: 'POST' }),
  link: (caseId: string, id: string) => request<AttachmentLink>(`/cases/${caseId}/attachments/${id}/link`),
  remove: (caseId: string, id: string) => request<void>(`/cases/${caseId}/attachments/${id}`, { method: 'DELETE' }),
  search: (q: string) => request<KnowledgeHit[]>(`/knowledge/search${queryString({ q })}`),
};

const attachmentKeys = (caseId: string) => [...caseKeys.all, 'attachments', caseId] as const;

export function useAttachments(caseId: string) {
  return useQuery({ queryKey: attachmentKeys(caseId), queryFn: () => attachmentsApi.list(caseId) });
}

export type PickedFile = { uri: string; name: string; mimeType: string; size: number };

/** Start, PUT the file to the signed URL, then confirm. The history gets an "Attached" note. */
export function useAttachFile(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, note }: { file: PickedFile; note: string }) => {
      if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('Files can be up to 10 MB.');
      const upload = await attachmentsApi.start(caseId, {
        file_name: file.name.slice(0, 200),
        content_type: file.mimeType,
        size_bytes: file.size,
        note: note.trim(),
      });
      const body = await (await fetch(file.uri)).blob();
      const put = await fetch(upload.upload_url, { method: 'PUT', headers: { 'Content-Type': upload.content_type }, body });
      if (!put.ok) throw new Error('Couldn’t upload the file. Check your connection and try again.');
      return attachmentsApi.uploaded(caseId, upload.attachment.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: attachmentKeys(caseId) });
      qc.invalidateQueries({ queryKey: caseKeys.detail(caseId) });
    },
  });
}

export function useRemoveAttachment(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => attachmentsApi.remove(caseId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: attachmentKeys(caseId) }),
  });
}

/** Full-text search over resources, resolved cases, their notes and attachment notes. */
export function useKnowledgeSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ['knowledge', query] as const,
    queryFn: () => attachmentsApi.search(query),
    enabled: query.length >= 2,
    staleTime: 30_000,
  });
}
