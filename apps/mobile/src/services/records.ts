/**
 * Records (/v1/records): Phantom debriefs. A worker captures one, the
 * background worker redacts and extracts it, the author reviews and
 * confirms it into a case. Records are private to their author.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { ConfirmRecord, ConfirmedRecord, CreateRecord, DebriefRecord, VoiceUpload } from '@/api/types';
import { caseKeys } from '@/services/cases';

export const recordsApi = {
  create: (body: CreateRecord) => request<DebriefRecord>('/records', { method: 'POST', body }),
  startVoice: (caseId?: string) =>
    request<VoiceUpload>('/records/voice', { method: 'POST', body: caseId ? { case_id: caseId } : undefined }),
  uploaded: (id: string) => request<DebriefRecord>(`/records/${id}/uploaded`, { method: 'POST' }),
  mine: () => request<DebriefRecord[]>('/records'),
  get: (id: string) => request<DebriefRecord>(`/records/${id}`),
  retry: (id: string) => request<DebriefRecord>(`/records/${id}/retry`, { method: 'POST' }),
  confirm: (id: string, body: ConfirmRecord) => request<ConfirmedRecord>(`/records/${id}/confirm`, { method: 'POST', body }),
  discard: (id: string) => request<DebriefRecord>(`/records/${id}`, { method: 'DELETE' }),
};

export const recordKeys = {
  all: ['records'] as const,
  mine: ['records', 'mine'] as const,
  detail: (id: string) => ['records', 'detail', id] as const,
};

/** Still in the pipeline: worth asking again soon. */
export const isProcessing = (r: DebriefRecord | undefined) => r?.status === 'processing' || r?.status === 'confirming';

export function useRecords() {
  return useQuery({
    queryKey: recordKeys.mine,
    queryFn: recordsApi.mine,
    // Poll while anything is processing, so "ready to review" shows up by itself.
    refetchInterval: (query) => (query.state.data?.some(isProcessing) ? 3_000 : 30_000),
  });
}

export function useRecord(id: string) {
  return useQuery({
    queryKey: recordKeys.detail(id),
    queryFn: () => recordsApi.get(id),
    refetchInterval: (query) => (isProcessing(query.state.data) ? 1_500 : false),
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return (record?: DebriefRecord) => {
    if (record) qc.setQueryData(recordKeys.detail(record.id), record);
    qc.invalidateQueries({ queryKey: recordKeys.all });
  };
}

export function useCreateRecord() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: recordsApi.create, onSuccess: refresh });
}

/** PUT the recording to the signed URL. Not through `request`: it goes
 *  straight to storage, with no API token. */
async function uploadAudio(upload: VoiceUpload, fileUri: string) {
  const file = await (await fetch(fileUri)).blob();
  if (file.size > upload.max_bytes) throw new Error('The recording is too long. Keep debriefs under about ten minutes.');
  const response = await fetch(upload.upload_url, { method: 'PUT', headers: { 'Content-Type': upload.content_type }, body: file });
  if (!response.ok) throw new Error('Couldn’t upload the recording. Check your connection and try again.');
}

/** A voice debrief, start to queued: a record and a signed URL, the upload,
 *  then telling the API it arrived. The local file is the caller's to delete.
 *  `caseId`: a debrief about an existing case (from the Responding screen). */
export function useSubmitVoice() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async ({ fileUri, caseId }: { fileUri: string; caseId?: string }) => {
      const upload = await recordsApi.startVoice(caseId);
      await uploadAudio(upload, fileUri);
      return recordsApi.uploaded(upload.record.id);
    },
    onSuccess: refresh,
  });
}

export function useRetryRecord(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: () => recordsApi.retry(id), onSuccess: refresh });
}

export function useDiscardRecord(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: () => recordsApi.discard(id), onSuccess: refresh });
}

export function useConfirmRecord(id: string) {
  const refresh = useRefresh();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfirmRecord) => recordsApi.confirm(id, body),
    onSuccess: (result) => {
      refresh(result.record);
      qc.invalidateQueries({ queryKey: caseKeys.all });
    },
  });
}
