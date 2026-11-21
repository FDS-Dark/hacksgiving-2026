import { useState } from 'react';
import { View } from 'react-native';

import { PostingCard } from '@/components/admin/PostingCard';
import { Actions, AttachmentField, ChoiceCards, FormErrors, Input, Pair, Picker, Section, Toggle } from '@/components/admin/form';
import { Button, FieldLabel, Txt } from '@/components/ui';
import {
  APPLY_METHODS,
  BENEFITS,
  CATEGORIES,
  DAYS,
  EMPLOYMENT_TYPES,
  LANGUAGES,
  PAY_PERIODS,
  PERKS,
  SETTINGS,
  applyHint,
  validate,
  type ApplyMethod,
  type Errors,
  type Posting,
  type PostingKind,
} from '@/lib/opportunities';
import { TRAINING_MODULES } from '@/lib/training';
import { space } from '@/theme/tokens';

const FIELD_NAMES: Partial<Record<keyof Posting, string>> = {
  title: 'Title',
  organization: 'Organization',
  category: 'Category',
  summary: 'Summary',
  description: 'Description',
  address: 'Address',
  startDate: 'Start date',
  endDate: 'End date',
  deadline: 'Deadline',
  expiresOn: 'Expires on',
  payMin: 'Pay',
  payMax: 'Max pay',
  openings: 'Openings',
  spots: 'Volunteer spots',
  minAge: 'Minimum age',
  applyValue: 'How to apply',
  contactName: 'Contact name',
  contactEmail: 'Contact email',
  contactPhone: 'Contact phone',
};

/**
 * Create or edit a job or volunteer posting. Drafts only need a title;
 * publishing checks everything a resident needs to apply.
 */
export function PostingForm({
  initial,
  isNew,
  onSave,
  onCancel,
}: {
  initial: Posting;
  isNew: boolean;
  onSave: (posting: Posting) => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState<Posting>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [preview, setPreview] = useState(false);

  const set = <K extends keyof Posting>(key: K, value: Posting[K]) => {
    setP((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const toggle = (key: 'days' | 'benefits' | 'perks' | 'languages' | 'training', item: string) => {
    const list = p[key];
    set(key, list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  };
  const text = (key: keyof Posting) => ({
    value: String(p[key] ?? ''),
    onChangeText: (v: string) => set(key, v as never),
    error: errors[key],
  });

  const submit = (status: Posting['status']) => {
    const found = validate(p, status === 'published');
    const bad = Object.values(found).some(Boolean);
    setErrors(found);
    if (!bad) onSave({ ...p, status });
  };


  const errorList = (Object.keys(errors) as (keyof Posting)[]).filter((k) => errors[k]);
  const isJob = p.kind === 'job';
  const apply = applyHint(p.applyMethod);

  return (
    <View style={{ gap: space.xl }}>
      {isNew ? (
        <Section title="What are you posting?" icon="albums-outline">
          <ChoiceCards<PostingKind>
            value={p.kind}
            onChange={(kind) => set('kind', kind)}
            options={[
              { value: 'job', icon: 'briefcase-outline', title: 'Job', body: 'Paid work: full-time, part-time, temporary.' },
              { value: 'volunteer', icon: 'hand-left-outline', title: 'Volunteer', body: 'Unpaid shifts, events, and ongoing roles.' },
            ]}
          />
        </Section>
      ) : null}

      <Section title="The basics" icon="document-text-outline">
        <Input label="Title *" placeholder={isJob ? 'e.g. Community Outreach Worker' : 'e.g. Food Drive Volunteer'} {...text('title')} />
        <Input label="Organization *" placeholder="ComForce MKE or partner name" {...text('organization')} />
        <Picker label="Category *" options={CATEGORIES} value={p.category} onChange={(v) => set('category', v)} error={errors.category} />
        <Input
          label={`Summary * (${p.summary.length}/140)`}
          placeholder="One line residents see in the list"
          maxLength={160}
          {...text('summary')}
        />
        <Input label="Description *" placeholder="What the role is and why it matters" multiline {...text('description')} />
        <Input
          label={isJob ? 'Responsibilities' : 'What volunteers will do'}
          placeholder="One per line"
          multiline
          {...text('responsibilities')}
        />
        <Input label={isJob ? 'Qualifications' : 'Requirements'} placeholder="One per line" multiline {...text('requirements')} />
      </Section>

      {isJob ? (
        <Section title="Job details" icon="briefcase-outline">
          <Picker label="Employment type" options={EMPLOYMENT_TYPES} value={p.employmentType} onChange={(v) => set('employmentType', v)} />
          <Pair>
            <Input half label="Pay from *" placeholder="18.00" keyboardType="decimal-pad" icon="cash-outline" {...text('payMin')} />
            <Input half label="Pay up to" placeholder="22.00" keyboardType="decimal-pad" {...text('payMax')} />
          </Pair>
          <Picker label="Paid per" options={PAY_PERIODS} value={p.payPeriod} onChange={(v) => set('payPeriod', v)} />
          <Picker label="Benefits" options={BENEFITS} multi={p.benefits} onChange={(v) => toggle('benefits', v)} />
          <Input label="Openings" keyboardType="number-pad" {...text('openings')} />
        </Section>
      ) : (
        <Section title="Volunteer details" icon="hand-left-outline">
          <Pair>
            <Input half label="Volunteers needed" keyboardType="number-pad" {...text('spots')} />
            <Input half label="Minimum age" keyboardType="number-pad" {...text('minAge')} />
          </Pair>
          <Toggle label="Background check required" value={p.backgroundCheck} onChange={(v) => set('backgroundCheck', v)} />
          <Toggle label="Groups welcome" detail="Teams, schools, churches, workplaces" value={p.groupsWelcome} onChange={(v) => set('groupsWelcome', v)} />
          <Picker
            label="Training required first"
            options={TRAINING_MODULES.map((m) => m.id)}
            labels={Object.fromEntries(TRAINING_MODULES.map((m) => [m.id, m.title]))}
            multi={p.training}
            onChange={(v) => toggle('training', v)}
          />
          <Picker label="Volunteers get" options={PERKS} multi={p.perks} onChange={(v) => toggle('perks', v)} />
        </Section>
      )}

      <Section title="Where" icon="location-outline">
        <Picker label="Setting" options={SETTINGS} value={p.setting} onChange={(v) => set('setting', v)} />
        {p.setting !== 'Remote' ? <Input label="Address *" placeholder="Street, city" textContentType="fullStreetAddress" {...text('address')} /> : null}
        <Input label="Neighborhood" placeholder="e.g. Harambee, Clarke Square" {...text('neighborhood')} />
        <Input label="Getting there" placeholder="Bus routes, parking" {...text('transit')} />
        <Input label="Accessibility" placeholder="Step-free entry, lifting required, etc." {...text('accessibility')} />
      </Section>

      <Section title="When" icon="calendar-outline">
        <Pair>
          <Input half label="Start date *" placeholder="YYYY-MM-DD" {...text('startDate')} />
          {p.ongoing ? null : <Input half label="End date" placeholder="YYYY-MM-DD" {...text('endDate')} />}
        </Pair>
        <Toggle label="Ongoing" detail="No end date" value={p.ongoing} onChange={(v) => set('ongoing', v)} />
        <Picker label="Days" options={DAYS} multi={p.days} onChange={(v) => toggle('days', v)} />
        <Pair>
          <Input half label="Hours" placeholder="9am–1pm" {...text('hours')} />
          <Input half label="Time commitment" placeholder={isJob ? '30 hrs/week' : '4-hour shifts'} {...text('commitment')} />
        </Pair>
      </Section>

      <Section title="Who can apply" icon="people-outline">
        <Picker label="Languages needed or welcome" options={LANGUAGES} multi={p.languages} onChange={(v) => toggle('languages', v)} />
      </Section>

      <Section title="How to apply" icon="paper-plane-outline">
        <Picker label="Method" options={APPLY_METHODS} value={p.applyMethod} onChange={(v) => set('applyMethod', v as ApplyMethod)} />
        {apply ? (
          <Input
            label={`${apply.label} *`}
            placeholder={apply.placeholder}
            keyboardType={p.applyMethod === 'Email' ? 'email-address' : p.applyMethod === 'Phone' ? 'phone-pad' : p.applyMethod === 'Website' ? 'url' : 'default'}
            autoCapitalize={p.applyMethod === 'In person' ? 'sentences' : 'none'}
            {...text('applyValue')}
          />
        ) : (
          <Txt variant="footnote" tone="secondary">
            Residents tap Apply and send their name and contact details to the contact below.
          </Txt>
        )}
        <Input label="Application deadline" placeholder="YYYY-MM-DD" {...text('deadline')} />
      </Section>

      <Section title="Contact" icon="call-outline">
        <Input label="Contact name *" placeholder="Name or team" textContentType="name" {...text('contactName')} />
        <Pair>
          <Input half label="Email" placeholder="name@example.org" keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" {...text('contactEmail')} />
          <Input half label="Phone" placeholder="(414) 555-0123" keyboardType="phone-pad" textContentType="telephoneNumber" {...text('contactPhone')} />
        </Pair>
      </Section>

      <Section title="Flyer or job description" icon="attach-outline">
        <AttachmentField value={p.attachment} onChange={(file) => set('attachment', file)} />
      </Section>

      <Section title="Publishing" icon="eye-outline">
        <Input label="Hide after" placeholder="YYYY-MM-DD (optional)" {...text('expiresOn')} />
        <Input label="Internal notes" placeholder="Only staff and partners see these" multiline {...text('internalNotes')} />
      </Section>

      {preview ? (
        <View style={{ gap: space.sm }}>
          <FieldLabel>Preview: how residents will see it</FieldLabel>
          <PostingCard posting={p} />
        </View>
      ) : null}

      <FormErrors fields={errorList.map((k) => FIELD_NAMES[k] ?? k)} />

      <Actions>
        <Button label={p.status === 'published' ? 'Save changes' : 'Publish'} icon="checkmark-circle-outline" onPress={() => submit('published')} />
        {p.status === 'published' ? null : <Button label="Save draft" variant="tinted" onPress={() => submit('draft')} />}
        <Button label={preview ? 'Hide preview' : 'Preview'} variant="tinted" icon="eye-outline" onPress={() => setPreview(!preview)} />
        <Button label="Cancel" variant="plain" onPress={onCancel} />
      </Actions>
    </View>
  );
}

