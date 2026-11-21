import type { IconName } from '@/components/ui';

export interface TrainingModule {
  id: string;
  title: string;
  icon: IconName;
  minutes: number;
  /** Must be done before a worker's first shift. */
  required: boolean;
  summary: string;
  points: string[];
}

/**
 * The worker training course. Static for now; it moves to the API once
 * training progress is stored per user.
 */
export const TRAINING_MODULES: readonly TrainingModule[] = [
  {
    id: 'orientation',
    title: 'Welcome to ComForce MKE',
    icon: 'people-outline',
    minutes: 10,
    required: true,
    summary: 'Our mission, how teams are organized, and who to call.',
    points: [
      'We empower, protect, and uplift Milwaukee residents. Every shift serves that.',
      'Check in with your team lead at the start and end of every shift.',
      'Wear your ComForce ID where residents can see it.',
      'Save your team lead’s number and the dispatch line in your phone before you go out.',
    ],
  },
  {
    id: 'field-safety',
    title: 'Field Safety',
    icon: 'shield-checkmark-outline',
    minutes: 15,
    required: true,
    summary: 'Working in pairs, check-ins, and when to leave.',
    points: [
      'Never go out alone. Stay within sight of your partner.',
      'Check in with dispatch every 60 minutes, and right away if plans change.',
      'Trust your gut: if a situation feels unsafe, leave and report it. You will never be faulted for leaving.',
      'In an emergency, call 911 first, then your team lead.',
    ],
  },
  {
    id: 'de-escalation',
    title: 'De-escalation Basics',
    icon: 'hand-left-outline',
    minutes: 20,
    required: true,
    summary: 'Calming tense moments with words, space, and patience.',
    points: [
      'Keep a calm voice and open posture. Leave the person, and yourself, a way out.',
      'Listen first. Repeat back what you hear so they know they were heard.',
      'Offer choices instead of orders.',
      'Do not argue, threaten, or touch. Step back and call for support if it keeps rising.',
    ],
  },
  {
    id: 'trauma-informed',
    title: 'Trauma-Informed Care',
    icon: 'heart-outline',
    minutes: 15,
    required: true,
    summary: 'Meeting residents where they are, without judgment.',
    points: [
      'Ask “what happened to you?”, not “what’s wrong with you?”.',
      'Explain what you are doing and why. Ask before helping.',
      'Let people decide what to share. Never push for details.',
      'Look after yourself too: debrief with your lead after a hard shift.',
    ],
  },
  {
    id: 'dv-response',
    title: 'Domestic Violence Response',
    icon: 'home-outline',
    minutes: 20,
    required: true,
    summary: 'Recognizing signs, safety planning, and warm handoffs.',
    points: [
      'Speak with the person privately. Never raise abuse in front of a partner.',
      'Believe them. Tell them it is not their fault.',
      'Share the Safety section of the app and the 24/7 hotline when it is safe to do so.',
      'If someone is in immediate danger, call 911.',
    ],
  },
  {
    id: 'referrals',
    title: 'Connecting Residents to Resources',
    icon: 'library-outline',
    minutes: 10,
    required: false,
    summary: 'Food, shelter, transportation, and crisis referrals.',
    points: [
      'Use the Resources section to find services that are open now.',
      'Call ahead with the resident when you can: a warm handoff beats a phone number.',
      'Write down what you referred and follow up on your next shift.',
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy & Confidentiality',
    icon: 'lock-closed-outline',
    minutes: 10,
    required: true,
    summary: 'What you may share, with whom, and what you must report.',
    points: [
      'Keep residents’ names and stories to your team and the people helping them.',
      'Do not post photos or details of residents or calls on social media.',
      'Suspected child or elder abuse must be reported to your team lead right away.',
    ],
  },
  {
    id: 'first-aid',
    title: 'First Aid & Narcan',
    icon: 'medkit-outline',
    minutes: 25,
    required: false,
    summary: 'Basic first aid and responding to a suspected overdose.',
    points: [
      'Check the scene is safe, then call 911.',
      'Signs of overdose: unresponsive, slow or no breathing, blue lips or fingertips.',
      'Give Narcan (naloxone) into one nostril. Give a second dose after 2–3 minutes if there is no response.',
      'Stay with the person and put them in the recovery position until help arrives.',
    ],
  },
];

export const REQUIRED_MODULES = TRAINING_MODULES.filter((m) => m.required);
