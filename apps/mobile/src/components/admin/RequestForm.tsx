import { useState } from 'react';
import { View } from 'react-native';

import { Actions, FormErrors, Input, Pair, Picker, Section, Toggle } from '@/components/admin/form';
import { Button, Notice } from '@/components/ui';
import { ASSIGNABLE } from '@/lib/directory';
import {
  CONTACT_METHODS,
  NEEDS,
  PRIORITIES,
  PRIORITY_LABEL,
  REQUEST_LANGUAGES,
  SOURCES,
  activity,
  validateRequest,
  type AssistRequest,
  type Priority,
} from '@/lib/requests';
import { space } from '@/theme/tokens';

const FIELD_NAMES: Partial<Record<keyof AssistRequest, string>> = {
  needs: 'Needs',
  summary: 'Summary',
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  followUpOn: 'Follow-up date',
};

const SAFETY = 'Safety / domestic violence';
const UNASSIGNED = 'Unassigned';

/** Staff intake for a request that came in by phone, text, walk-in, or referral. */
export function RequestForm({
  initial,
  by,
  onSave,
  onCancel,
}: {
  initial: AssistRequest;
  by: string;
  onSave: (request: AssistRequest) => void;
  onCancel: () => void;
}) {
  const [r, setR] = useState<AssistRequest>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof AssistRequest, string>>>({});

  const set = <K extends keyof AssistRequest>(key: K, value: AssistRequest[K]) => {
    setR((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const text = (key: 'summary' | 'details' | 'name' | 'phone' | 'email' | 'neighborhood' | 'householdSize' | 'safeTimes' | 'followUpOn') => ({
    value: r[key],
    onChangeText: (v: string) => set(key, v),
    error: errors[key],
  });

  const toggleNeed = (need: string) => {
    const on = !r.needs.includes(need);
    set('needs', on ? [...r.needs, need] : r.needs.filter((n) => n !== need));
    // DV requests are confidential by default and never wait in the normal queue.
    if (need === SAFETY && on) {
      setR((prev) => ({ ...prev, confidential: true, priority: prev.priority === 'urgent' ? 'urgent' : 'high' }));
    }
  };

  const submit = () => {
    const found = validateRequest(r);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    const log = [...r.activity];
    if (r.assignee) log.push(activity(by, 'assign', `Assigned to ${r.assignee}`));
    onSave({ ...r, status: r.assignee ? 'in_progress' : 'new', activity: log });
  };

  const errorList = (Object.keys(errors) as (keyof AssistRequest)[]).filter((k) => errors[k]).map((k) => FIELD_NAMES[k] ?? k);

  return (
    <View style={{ gap: space.xl }}>
      <Section title="What they need" icon="help-buoy-outline">
        <Picker label="Needs *" options={NEEDS} multi={r.needs} onChange={toggleNeed} error={errors.needs} />
        {r.needs.includes(SAFETY) ? (
          <Notice icon="warning-outline" tone="warning">
            If anyone is in immediate danger, call 911. Offer the DV hotline, and don’t call, text, or leave messages unless they say it’s safe.
          </Notice>
        ) : null}
        <Input label="Summary *" placeholder="e.g. Family of 4 needs groceries this week" {...text('summary')} />
        <Input label="Details" placeholder="Anything that helps the next person (no more than needed)" multiline {...text('details')} />
        <Picker
          label="Priority"
          options={PRIORITIES}
          labels={PRIORITY_LABEL}
          value={r.priority}
          onChange={(v) => set('priority', v as Priority)}
        />
        <Picker label="How they reached us" options={SOURCES} value={r.source} onChange={(v) => set('source', v)} />
      </Section>

      <Section title="Who" icon="person-outline">
        <Input label="Name *" placeholder="First name, or “Anonymous”" {...text('name')} />
        <Pair>
          <Input half label="Phone" placeholder="(414) 555-0123" keyboardType="phone-pad" {...text('phone')} />
          <Input half label="Email" placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" {...text('email')} />
        </Pair>
        <Picker label="Best way to reach them" options={CONTACT_METHODS} value={r.preferredContact} onChange={(v) => set('preferredContact', v)} />
        <Picker label="Language" options={REQUEST_LANGUAGES} value={r.language} onChange={(v) => set('language', v)} />
        <Pair>
          <Input half label="Neighborhood" placeholder="e.g. Sherman Park" {...text('neighborhood')} />
          <Input half label="People in household" keyboardType="number-pad" {...text('householdSize')} />
        </Pair>
      </Section>

      <Section title="Safe contact" icon="shield-checkmark-outline">
        <Toggle label="Safe to call" value={r.safeToCall} onChange={(v) => set('safeToCall', v)} />
        <Toggle label="Safe to text" value={r.safeToText} onChange={(v) => set('safeToText', v)} />
        <Toggle label="Safe to leave a voicemail" value={r.safeToVoicemail} onChange={(v) => set('safeToVoicemail', v)} />
        <Input label="Safe times or other instructions" placeholder="e.g. Weekdays before 3pm only" {...text('safeTimes')} />
      </Section>

      <Section title="Privacy" icon="lock-closed-outline">
        <Toggle
          label="Confidential"
          detail="ComForce staff only. Hidden from partners, and details stay out of referrals."
          value={r.confidential}
          onChange={(v) => set('confidential', v)}
        />
        <Toggle
          label="Resident agreed to share their details with a partner"
          detail="Ask before any referral: “Is it OK if I share your name and number with …?”"
          value={r.consentToShare}
          onChange={(v) => set('consentToShare', v)}
        />
      </Section>

      <Section title="Next step" icon="arrow-forward-circle-outline">
        <Picker
          label="Assign to"
          options={[UNASSIGNED, ...ASSIGNABLE]}
          value={r.assignee ?? UNASSIGNED}
          onChange={(v) => set('assignee', v === UNASSIGNED ? null : v)}
        />
        <Input label="Follow up on" placeholder="YYYY-MM-DD (optional)" {...text('followUpOn')} />
      </Section>

      <FormErrors fields={errorList} />

      <Actions>
        <Button label="Save request" icon="checkmark-circle-outline" onPress={submit} />
        <Button label="Cancel" variant="plain" onPress={onCancel} />
      </Actions>
    </View>
  );
}
