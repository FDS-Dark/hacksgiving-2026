import { useState } from 'react';
import { View } from 'react-native';

import { Actions, FormErrors, Input, Pair, Picker, Section } from '@/components/admin/form';
import { Button } from '@/components/ui';
import { PARTNER_STATUS_LABEL, SERVICE_CATEGORIES, validateService, type PartnerStatus, type Service } from '@/lib/services';
import { space } from '@/theme/tokens';

type TextKey = Exclude<keyof Service, 'id' | 'status' | 'category'>;

const FIELD_NAMES: Partial<Record<keyof Service, string>> = {
  name: 'Name',
  category: 'Category',
  phone: 'Phone, website, or address',
  website: 'Website',
  contactEmail: 'Contact email',
  lastVerified: 'Last verified',
  lastContacted: 'Last contacted',
};

/** Add or edit a service in the directory. */
export function ServiceForm({ initial, isNew, onSave, onCancel }: { initial: Service; isNew: boolean; onSave: (s: Service) => void; onCancel: () => void }) {
  const [s, setS] = useState<Service>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Service, string>>>({});

  const set = <K extends keyof Service>(key: K, value: Service[K]) => {
    setS((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const text = (key: TextKey) => ({ value: s[key], onChangeText: (v: string) => set(key, v), error: errors[key] });

  const submit = () => {
    const found = validateService(s);
    setErrors(found);
    if (!Object.values(found).some(Boolean)) onSave(s);
  };
  const errorList = (Object.keys(errors) as (keyof Service)[]).filter((k) => errors[k]).map((k) => FIELD_NAMES[k] ?? k);

  return (
    <View style={{ gap: space.xl }}>
      <Section title="The service" icon="business-outline">
        <Input label="Name *" placeholder="e.g. Northside Food Pantry" {...text('name')} />
        <Picker label="Category *" options={SERVICE_CATEGORIES} value={s.category} onChange={(v) => set('category', v)} error={errors.category} />
        <Input label="What they offer" placeholder="One or two lines residents will read" multiline {...text('description')} />
        <Input label="Who can use it" placeholder="Eligibility, ages, documents needed" {...text('eligibility')} />
        <Input label="Languages" placeholder="English, Spanish" {...text('languages')} />
      </Section>

      <Section title="How to reach it" icon="call-outline">
        <Pair>
          <Input half label="Phone" placeholder="(414) 555-0123" keyboardType="phone-pad" {...text('phone')} />
          <Input half label="Website" placeholder="https://…" keyboardType="url" autoCapitalize="none" {...text('website')} />
        </Pair>
        <Input label="Address" placeholder="Street, city" {...text('address')} />
        <Input label="Hours" placeholder="e.g. Mon–Fri 9am–5pm" {...text('hours')} />
      </Section>

      <Section title="Our relationship" icon="people-outline">
        <Picker
          label="Status"
          options={Object.keys(PARTNER_STATUS_LABEL)}
          labels={PARTNER_STATUS_LABEL}
          value={s.status}
          onChange={(v) => set('status', v as PartnerStatus)}
        />
        <Input label="Contact person" placeholder="Name and role" {...text('contactName')} />
        <Pair>
          <Input half label="Contact email" placeholder="name@example.org" keyboardType="email-address" autoCapitalize="none" {...text('contactEmail')} />
          <Input half label="Contact phone" placeholder="Direct line" keyboardType="phone-pad" {...text('contactPhone')} />
        </Pair>
        <Pair>
          <Input half label="Info last verified" placeholder="YYYY-MM-DD" {...text('lastVerified')} />
          <Input half label="Last contacted" placeholder="YYYY-MM-DD" {...text('lastContacted')} />
        </Pair>
        <Input label="Internal notes" placeholder="Capacity, intake tips, who to ask for" multiline {...text('notes')} />
      </Section>

      <FormErrors fields={errorList} />
      <Actions>
        <Button label={isNew ? 'Add service' : 'Save changes'} icon="checkmark-circle-outline" onPress={submit} />
        <Button label="Cancel" variant="plain" onPress={onCancel} />
      </Actions>
    </View>
  );
}
