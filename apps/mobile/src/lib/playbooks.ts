/**
 * How a ComForce worker handles a request in each service: when to escalate,
 * what to ask, the steps, what to avoid, and who to call.
 *
 * DRAFT: written for the hackathon from public sources, not by ComForce MKE.
 * Have program leads review the steps before workers rely on them. Phone
 * numbers and links were checked on PLAYBOOKS_CHECKED_ON; agencies change
 * them, so re-check a few times a year.
 */
import type { CaseCategory } from '@/api/types';

export const PLAYBOOKS_CHECKED_ON = 'November 21, 2026';

export interface Contact {
  name: string;
  /** What they do, in a line. */
  detail: string;
  phone?: string;
  url?: string;
}

export interface Playbook {
  /** One line: what this service is for. */
  summary: string;
  /** Stop and escalate right away (911 or a crisis line) when any of these is true. */
  urgentIf: string[];
  /** What to find out on the first contact. */
  ask: string[];
  /** The handling steps, in order. */
  steps: string[];
  avoid: string[];
  contacts: Contact[];
}

const EMERGENCY: Contact = { name: '911', detail: 'Anyone in immediate danger to life or safety.', phone: '911' };
const CRISIS_988: Contact = { name: '988 Suicide & Crisis Lifeline', detail: 'Call or text, 24/7, for anyone in emotional crisis.', phone: '988', url: 'https://988lifeline.org' };
const COUNTY_CRISIS: Contact = {
  name: 'Milwaukee County Crisis Line',
  detail: '24/7 non-police mobile crisis team (counselors, nurses) that can come out.',
  phone: '414-257-7222',
  url: 'https://county.milwaukee.gov/EN/DHHS/BHD/Milwaukee-Mobile-Crisis',
};
const IMPACT_211: Contact = {
  name: 'IMPACT 2-1-1',
  detail: '24/7 front door for emergency shelter, homelessness prevention, food and other services.',
  phone: '414-773-0211',
  url: 'https://www.impactinc.org',
};
const MPD_NON_EMERGENCY: Contact = {
  name: 'Milwaukee Police non-emergency',
  detail: 'Reports that are not an emergency in progress (option 9).',
  phone: '414-933-4444',
  url: 'https://city.milwaukee.gov/not911',
};

export const PLAYBOOKS: Record<CaseCategory, Playbook> = {
  homelessness: {
    summary: 'People without a safe place to sleep tonight, facing eviction, or living in a car or outside.',
    urgentIf: [
      'Someone is outside in dangerous cold or heat, especially children, elders or anyone sick.',
      'They are fleeing violence: also follow the Violence Prevention guide.',
      'They mention wanting to hurt themselves.',
    ],
    ask: [
      'Where will you sleep tonight? Is anyone with you (children, partner, pets)?',
      'Do you have an eviction notice or court date? When?',
      'Do you have ID, income, or a phone we can reach you on?',
      'Any health needs, disabilities or medications we should plan around?',
    ],
    steps: [
      'Tonight first: connect them to emergency shelter through 2-1-1. Families and individuals use different shelters.',
      'If there is an eviction notice, record the date and connect them to legal help before the court date.',
      'Get them into Coordinated Entry for longer-term housing (2-1-1 does the intake).',
      'Cover the basics while they wait: meals, a phone charger, transportation to the shelter.',
      'Set a follow-up within 24 hours and log what was arranged as an internal note.',
    ],
    avoid: [
      "Promising a specific bed or apartment: shelter space changes by the hour.",
      'Sending someone across town without a confirmed spot or a way to get there.',
    ],
    contacts: [
      IMPACT_211,
      { name: 'Milwaukee Continuum of Care', detail: 'Coordinated Entry for housing programs in Milwaukee County.', url: 'https://milwaukeecoc.org/coordinated-entry/' },
      EMERGENCY,
    ],
  },

  meal_programs: {
    summary: 'Hunger, no food at home, or needing meals, groceries or a food pantry.',
    urgentIf: ['A child, elder or someone with a medical condition (like diabetes) has gone without food.'],
    ask: [
      'How many people are you feeding, and any children or elders?',
      'Can you cook where you are staying, or do you need ready-to-eat meals?',
      'Can you get to a pantry, or do you need delivery or a ride?',
      'Any allergies, dietary or cultural needs?',
    ],
    steps: [
      "Find the nearest open pantry or meal site on Hunger Task Force's emergency food map, or through 2-1-1.",
      'Call ahead when you can: hours change. Tell them who is coming.',
      'If they cannot travel, arrange a ride (Ride help) or a delivery program.',
      'Screen for longer-term help: FoodShare (SNAP), WIC for young children, school meals.',
      'Log the referral and check in after the first visit.',
    ],
    avoid: ['Sending someone to a pantry without checking it is open today.', 'Asking for proof of income: most emergency pantries do not require it.'],
    contacts: [
      { name: 'Hunger Task Force', detail: 'Free emergency food; map of trusted pantries and meal sites.', phone: '414-777-0483', url: 'https://www.hungertaskforce.org/get-help/emergency-food' },
      IMPACT_211,
    ],
  },

  transportation: {
    summary: 'Rides to appointments, court, work, a shelter or a service; no car or bus fare.',
    urgentIf: ['The ride is to emergency medical care: call 911 instead of arranging a ride.'],
    ask: [
      'Where and when do you need to be? Is it a court date or medical appointment?',
      'Do you use a wheelchair or need help getting in and out of a vehicle?',
      'Is this one ride or a regular trip (work, treatment)?',
    ],
    steps: [
      'Court dates and medical appointments come first: confirm the time and address.',
      'For regular trips, check reduced-fare bus eligibility (WisGo card: seniors, kids, people with disabilities, Medicare).',
      'For riders with disabilities, Transit Plus paratransit must be booked a day ahead.',
      'If no option works in time, escalate to a lead for a ComForce ride or bus pass.',
      'Log the ride details and confirm it happened.',
    ],
    avoid: ['Booking a ride that arrives after the appointment starts: leave a buffer.'],
    contacts: [
      { name: 'MCTS reduced fare (WisGo)', detail: 'Half-price bus fare for eligible riders.', url: 'https://www.ridemcts.com/fares/reduced-fare' },
      { name: 'MCTS Transit Plus', detail: 'Paratransit vans for riders with disabilities; book 24 hours ahead.', phone: '414-343-1700', url: 'https://www.ridemcts.com/accessibility/transit-plus' },
    ],
  },

  violence_prevention: {
    summary: 'Threats, shootings, group conflict, retaliation, or domestic and community violence.',
    urgentIf: [
      'A weapon is involved, someone was just hurt, or a threat is for today: call 911.',
      'Talk of retaliation for a recent shooting: escalate to a lead now.',
      'Someone is with the person hurting them right now.',
    ],
    ask: [
      'Are you safe right now? Is it safe to talk?',
      'Who is involved, and is there a deadline or event (a funeral, a party) where it could flare up?',
      'Is this someone you live with or are in a relationship with? (Then follow the domestic violence steps.)',
      'What is a safe way and time to reach you?',
    ],
    steps: [
      'Safety first: if danger is immediate, 911. Otherwise make a safety plan with them.',
      'Domestic violence: connect them to Sojourner Family Peace Center (24/7 hotline or text line).',
      'Community or group conflict: bring in violence interrupters (414LIFE) quickly; timing matters.',
      'Keep details confidential: record facts, not rumors, and mark notes internal.',
      'Follow up within a day; retaliation risk often peaks in the first days.',
    ],
    avoid: [
      'Contacting the other party yourself without a lead or interrupter.',
      'Sharing who reported what with anyone involved.',
      'Messaging a domestic violence survivor on a phone the abuser may see: ask first.',
    ],
    contacts: [
      EMERGENCY,
      { name: 'Sojourner Family Peace Center', detail: '24/7 domestic violence hotline; text line 414-877-8100.', phone: '414-933-2722' },
      { name: '414LIFE', detail: "Milwaukee's violence interruption program (City + Medical College of Wisconsin).", url: 'https://city.milwaukee.gov/414Life' },
    ],
  },

  incident_deescalation: {
    summary: 'A tense situation happening now or brewing: an argument, a fight about to start, someone agitated or in crisis.',
    urgentIf: ['A weapon, someone hurt, or a fight already under way: call 911.', 'Someone is threatening to hurt themselves: 988 or the County Crisis Line.'],
    ask: [
      'Where exactly is it happening, and is it happening right now?',
      'How many people, and does anyone have a weapon?',
      'Is someone in a mental health crisis or under the influence?',
    ],
    steps: [
      'Decide in the first minute: 911 (danger), County Crisis Line (mental health crisis), or a ComForce response.',
      'Never go alone. Send two people, and tell a lead where you are going.',
      'On scene: calm voice, give space, one person talks, offer choices, no sudden moves.',
      'Separate the people involved once it is calmer; listen to each side.',
      'Afterwards, log what happened and connect anyone involved to follow-up services.',
    ],
    avoid: ['Physical contact or blocking someone\'s exit.', 'Arguing about who is right while emotions are high.', 'Going to a scene with a reported weapon.'],
    contacts: [EMERGENCY, COUNTY_CRISIS, CRISIS_988],
  },

  missing_persons: {
    summary: "Someone (a child, relative or friend) is missing, ran away, or can't be reached.",
    urgentIf: [
      'The person is 11 or younger, suicidal, has dementia or a medical condition, or is a veteran: MPD treats these as critical, call 911.',
      'There is any sign of foul play.',
    ],
    ask: [
      'Who is missing, how old, and when and where were they last seen?',
      'What were they wearing? Do you have a recent photo?',
      'Have you filed a police report? Is there a report number?',
      'Phone, social media, car, places they might go, people they might be with?',
    ],
    steps: [
      'Tell the family there is NO 24-hour waiting period: they can report right away, at any MPD district station.',
      'Help them file the report and record the report number in the case.',
      'Help with flyers and sharing (with the family\'s OK), and organize a search only with police aware of it.',
      'For a missing child, also contact the National Center for Missing & Exploited Children.',
      'Check in daily; support the family, not only the search.',
    ],
    avoid: ['Posting photos or details publicly without the family\'s consent.', 'Telling the family to wait before reporting.'],
    contacts: [
      EMERGENCY,
      MPD_NON_EMERGENCY,
      { name: 'National Center for Missing & Exploited Children', detail: '24/7 hotline for missing children.', phone: '1-800-843-5678', url: 'https://www.missingkids.org' },
      { name: 'NamUs', detail: 'National missing and unidentified persons database.', url: 'https://namus.nij.ojp.gov' },
    ],
  },

  burial_assistance: {
    summary: 'A family that needs help paying for or arranging a funeral or burial.',
    urgentIf: ['The death was violent or recent and the family is at risk: also follow the Violence Prevention guide.', 'Anyone grieving talks about hurting themselves: 988.'],
    ask: [
      'Who passed away, and when? Have you chosen a funeral home?',
      'Was the person on Medicaid or BadgerCare?',
      'What has the family been quoted, and what can they cover?',
      'Any religious or cultural needs for the service?',
    ],
    steps: [
      'Lead with condolences; move at the family\'s pace.',
      'If the person had Medicaid or BadgerCare, the funeral home can apply to the state Funeral and Cemetery Aids Program (WFCAP). Only the provider files it, so tell the family to ask their funeral home.',
      'Check other sources: life insurance, veterans burial benefits, crime victim compensation for violent deaths.',
      'Refer to ComForce or partner funds for the remaining gap, and record amounts in an internal note.',
      'Offer grief support and check in after the service.',
    ],
    avoid: ['Recommending a specific funeral home as the only option.', 'Promising an amount before funding is confirmed.'],
    contacts: [
      { name: 'Wisconsin Funeral and Cemetery Aids Program', detail: 'State help with funeral costs for Medicaid/BadgerCare members (the funeral home applies).', phone: '888-859-0611', url: 'https://www.dhs.wisconsin.gov/em/wfcap.htm' },
      CRISIS_988,
    ],
  },

  bridge_to_employment: {
    summary: 'Wanting a job, job training, a resume, interview help, or work after incarceration.',
    urgentIf: ['They have no income for food or housing right now: also open Meals or Housing help.'],
    ask: [
      'What work have you done, and what would you like to do?',
      'Do you have ID, a Social Security card, and a way to get to work?',
      'Any record we should plan around? (Only to find the right programs.)',
      'Any childcare or schedule limits?',
    ],
    steps: [
      'Start with documents: missing ID or Social Security cards block most hiring.',
      'Refer to Employ Milwaukee for job readiness, training and placement; it has reentry staff for people leaving incarceration.',
      'Help with a resume and interview practice, or connect them to a program that does.',
      'Solve barriers: interview clothes, transportation (bus pass), childcare.',
      'Follow up after interviews and in the first weeks of a new job.',
    ],
    avoid: ['Assuming a record rules someone out: many employers and programs hire people with records.'],
    contacts: [{ name: 'Employ Milwaukee', detail: 'Job training, placement and reentry services.', phone: '414-270-1700', url: 'https://employmilwaukee.org' }],
  },

  other: {
    summary: 'Requests that do not fit one service yet. Find out what is going on, then re-route.',
    urgentIf: ['Anyone in immediate danger: 911.', 'Emotional crisis or thoughts of self-harm: 988 or the County Crisis Line.'],
    ask: ['What is the most important thing you need help with today?', 'Is anyone in danger?', 'What have you already tried?'],
    steps: [
      'Talk with the person and figure out the main need.',
      'Re-route the case to the right service in Triage below; the matching guide will show up.',
      'If nothing fits, use 2-1-1 to find the right agency, and record the referral.',
    ],
    avoid: ['Closing a request because it does not fit a category: route it instead.'],
    contacts: [IMPACT_211, EMERGENCY, CRISIS_988],
  },
};
