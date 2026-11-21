import { useState } from 'react';
import { View } from 'react-native';

import { Actions, AttachmentField, ChoiceCards, FormErrors, Input, Pair, Picker, Section, Toggle } from '@/components/admin/form';
import { Button } from '@/components/ui';
import { AUDIENCE_LABEL, FOLDERS, KIND_ICON, KIND_LABEL, POST_KINDS, parseTags, validatePost, type Audience, type InfoPost, type PostKind } from '@/lib/infohub';
import { space } from '@/theme/tokens';

const KIND_BLURB: Record<PostKind, string> = {
  announcement: 'News for the team: shift changes, alerts, reminders.',
  guide: 'How we do things: steps, policies, scripts.',
  contact: 'A person, hotline, or partner to call.',
  file: 'A form, flyer, or template to download.',
  link: 'A website or online tool.',
};

const FIELD_NAMES: Partial<Record<keyof InfoPost, string>> = {
  title: 'Title',
  body: 'Text',
  link: 'Link',
  phone: 'Phone',
  email: 'Email',
  attachment: 'File',
  expiresOn: 'Remove after',
};

/** Create or edit an info hub post. */
export function PostForm({ initial, isNew, onSave, onCancel }: { initial: InfoPost; isNew: boolean; onSave: (p: InfoPost) => void; onCancel: () => void }) {
  const [p, setP] = useState<InfoPost>(initial);
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [errors, setErrors] = useState<Partial<Record<keyof InfoPost, string>>>({});

  const set = <K extends keyof InfoPost>(key: K, value: InfoPost[K]) => {
    setP((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const text = (key: 'title' | 'body' | 'link' | 'phone' | 'email' | 'expiresOn') => ({
    value: p[key],
    onChangeText: (v: string) => set(key, v),
    error: errors[key],
  });

  const submit = () => {
    const found = validatePost(p);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    onSave({ ...p, tags: parseTags(tags), updatedAt: new Date().toISOString() });
  };

  const errorList = (Object.keys(errors) as (keyof InfoPost)[]).filter((k) => errors[k]).map((k) => FIELD_NAMES[k] ?? k);

  return (
    <View style={{ gap: space.xl }}>
      {isNew ? (
        <Section title="What are you sharing?" icon="albums-outline">
          <ChoiceCards<PostKind>
            value={p.kind}
            onChange={(kind) => set('kind', kind)}
            options={POST_KINDS.map((k) => ({ value: k, icon: KIND_ICON[k], title: KIND_LABEL[k], body: KIND_BLURB[k] }))}
          />
        </Section>
      ) : null}

      <Section title="Content" icon="document-text-outline">
        <Input label="Title *" placeholder={p.kind === 'contact' ? 'e.g. Harbor House: intake desk' : 'A clear, specific title'} {...text('title')} />
        <Input
          label={p.kind === 'announcement' || p.kind === 'guide' ? 'Text *' : 'Description'}
          placeholder={p.kind === 'guide' ? 'Steps, one per line' : 'What people need to know'}
          multiline
          {...text('body')}
        />
        {p.kind === 'contact' ? (
          <Pair>
            <Input half label="Phone" placeholder="(414) 555-0123" keyboardType="phone-pad" {...text('phone')} />
            <Input half label="Email" placeholder="name@example.org" keyboardType="email-address" autoCapitalize="none" {...text('email')} />
          </Pair>
        ) : null}
        <Input
          label={p.kind === 'link' ? 'Link *' : 'Link'}
          placeholder="https://…"
          keyboardType="url"
          autoCapitalize="none"
          {...text('link')}
        />
        <AttachmentField
          value={p.attachment}
          onChange={(file) => set('attachment', file)}
          hint={p.kind === 'file' ? 'Required. Up to 10 MB.' : 'Optional. Up to 10 MB.'}
          error={errors.attachment}
        />
      </Section>

      <Section title="Organize" icon="folder-open-outline">
        <Picker label="Folder" options={FOLDERS} value={p.folder} onChange={(v) => set('folder', v)} />
        <Input label="Tags" placeholder="Comma separated, e.g. winter, outreach" autoCapitalize="none" value={tags} onChangeText={setTags} />
        <Toggle label="Pin to the top" value={p.pinned} onChange={(v) => set('pinned', v)} />
      </Section>

      <Section title="Share with" icon="people-outline">
        <Picker
          label="Who can see it"
          options={Object.keys(AUDIENCE_LABEL)}
          labels={AUDIENCE_LABEL}
          value={p.audience}
          onChange={(v) => set('audience', v as Audience)}
        />
        <Toggle
          label="Ask everyone to confirm they’ve read it"
          detail="For policy changes and safety alerts."
          value={p.requireAck}
          onChange={(v) => set('requireAck', v)}
        />
        <Input label="Remove after" placeholder="YYYY-MM-DD (optional)" {...text('expiresOn')} />
      </Section>

      <FormErrors fields={errorList} />

      <Actions>
        <Button label={isNew ? 'Post' : 'Save changes'} icon="checkmark-circle-outline" onPress={submit} />
        <Button label="Cancel" variant="plain" onPress={onCancel} />
      </Actions>
    </View>
  );
}
