import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { toApiError } from '@/api/client';
import type { Attachment } from '@/api/types';
import { Button, ErrorBanner, Field, Notice, success } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { ATTACHMENT_TYPES, attachmentsApi, useAttachFile, useAttachments, useRemoveAttachment, type PickedFile } from '@/services/attachments';
import { space, type, useTheme } from '@/theme/tokens';

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The case's Files tab: photos and PDFs (ID, notices, letters). Tap one to open it; attach with a short note. */
export function CaseAttachments({ caseId }: { caseId: string }) {
  const theme = useTheme();
  const attachments = useAttachments(caseId);
  const attach = useAttachFile(caseId);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [note, setNote] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<unknown>(null);
  const off = attach.error ? toApiError(attach.error).status === 503 : false;

  const pick = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ATTACHMENT_TYPES, copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets?.length) return;
    const a = result.assets[0];
    setPicked({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? 'application/octet-stream', size: a.size ?? 0 });
    attach.reset();
  };

  const open = async (a: Attachment) => {
    setOpening(a.id);
    setOpenError(null);
    try {
      const link = await attachmentsApi.link(caseId, a.id);
      await WebBrowser.openBrowserAsync(link.url);
    } catch (e) {
      setOpenError(e);
    } finally {
      setOpening(null);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      {attachments.data?.length ? (
        <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          {attachments.data.map((a, i) => (
            <AttachmentRow key={a.id} caseId={caseId} item={a} first={i === 0} busy={opening === a.id} onOpen={() => open(a)} />
          ))}
        </View>
      ) : attachments.isPending ? null : (
        <Text style={[type.subhead, { color: theme.textSecondary }]}>No files yet. Attach an ID, a notice or a letter so the team has it.</Text>
      )}
      {openError ? <ErrorBanner error={openError} /> : null}

      {picked ? (
        <View style={[styles.picked, { backgroundColor: theme.fill }]}>
          <Text style={[type.subhead, { color: theme.text, fontWeight: '600' }]} numberOfLines={1}>
            {picked.name} · {size(picked.size)}
          </Text>
          <Field label="What is it? (searchable)" placeholder="e.g. Eviction notice dated Nov 18" value={note} onChangeText={setNote} maxLength={1000} />
          <View style={styles.actions}>
            <Button label="Cancel" variant="plain" onPress={() => setPicked(null)} disabled={attach.isPending} />
            <Button
              label="Attach"
              icon="cloud-upload-outline"
              loading={attach.isPending}
              onPress={() =>
                attach.mutate(
                  { file: picked, note },
                  {
                    onSuccess: () => {
                      success();
                      setPicked(null);
                      setNote('');
                    },
                  },
                )
              }
            />
          </View>
        </View>
      ) : (
        <Button label="Attach a photo or PDF" icon="attach-outline" variant="tinted" onPress={pick} />
      )}
      {off ? (
        <Notice icon="cloud-offline-outline">File storage isn’t set up on this server, so files can’t be attached yet.</Notice>
      ) : attach.error ? (
        <ErrorBanner error={attach.error} />
      ) : null}
    </View>
  );
}

function AttachmentRow({ caseId, item: a, first, busy, onOpen }: { caseId: string; item: Attachment; first: boolean; busy: boolean; onOpen: () => void }) {
  const theme = useTheme();
  const remove = useRemoveAttachment(caseId);
  const image = a.content_type.startsWith('image/');
  return (
    <View style={[styles.row, !first && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <Pressable onPress={onOpen} disabled={busy} accessibilityRole="button" accessibilityLabel={`Open ${a.file_name}`} style={({ pressed }) => [styles.main, (pressed || busy) && { opacity: 0.6 }]}>
        <Ionicons name={image ? 'image-outline' : 'document-text-outline'} size={24} color={theme.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.subhead, { color: theme.text, fontWeight: '600' }]} numberOfLines={1}>
            {a.file_name}
          </Text>
          {a.note ? <Text style={[type.footnote, { color: theme.text }]} numberOfLines={2}>{a.note}</Text> : null}
          <Text style={[type.caption, { color: theme.textSecondary }]}>
            {[size(a.size_bytes), a.uploaded_by_name, timeAgo(a.created_at)].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </Pressable>
      <Pressable onPress={() => remove.mutate(a.id)} disabled={remove.isPending} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${a.file_name}`}>
        <Ionicons name="trash-outline" size={18} color={theme.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  picked: { gap: space.sm, borderRadius: 14, padding: space.md },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
});
