/**
 * The API's types, by name. Every one comes from the generated schema
 * (schema.ts, from api/ via openapi.json: `npm run gen:api`); nothing here
 * is written by hand except the lists of enum values the UI iterates.
 */
import type { components, operations } from './schema';

type Schemas = components['schemas'];

export type AppUser = Schemas['AppUser'];
export type UpdateMe = Schemas['UpdateMeRequest'];

// ── Case management (worker portal and community requests) ──────────────
export type CaseCategory = Schemas['CaseCategory'];
export type CaseKind = Schemas['CaseKind'];
export type CasePriority = Schemas['CasePriority'];
export type CaseStatus = Schemas['CaseStatus'];
export type ReferralStatus = Schemas['ReferralStatus'];
export type Role = Schemas['Role'];
export type UpdateType = Schemas['UpdateType'];
export type Visibility = Schemas['Visibility'];

export type Case = Schemas['Case'];
export type CaseDetail = Schemas['CaseDetail'];
export type CaseUpdate = Schemas['CaseUpdate'];
export type CaseInsights = Schemas['CaseInsights'];
export type CaseStats = Schemas['CaseStats'];
export type CreateCase = Schemas['CreateCaseRequest'];
export type UpdateCase = Schemas['UpdateCaseRequest'];
export type AddCaseUpdate = Schemas['AddCaseUpdateRequest'];
export type CaseFilters = NonNullable<operations['list_cases_v1_cases_get']['parameters']['query']>;
export type Referral = Schemas['Referral'];
export type AddReferral = Schemas['AddReferralRequest'];
export type UpdateReferral = Schemas['UpdateReferralRequest'];
export type Resource = Schemas['Resource'];
export type CreateResource = Schemas['CreateResourceRequest'];
export type CaseSummary = Schemas['CaseSummary'];
export type ResourceSuggestions = Schemas['ResourceSuggestions'];

// ── Volunteer, job and education opportunities ─────────────────────────────
export type Opportunity = Schemas['Opportunity'];
export type OpportunityKind = Schemas['OpportunityKind'];
export type CreateOpportunity = Schemas['CreateOpportunityRequest'];
export type Audience = Schemas['Audience'];
export type Cost = Schemas['Cost'];
export type OpportunityOrigin = Schemas['OpportunityOrigin'];
export const OPPORTUNITY_KINDS = ['job', 'education', 'volunteer'] as const satisfies readonly OpportunityKind[];
export const AUDIENCES = [
  'second_chance',
  'unhoused',
  'no_experience',
  'no_id_required',
  'youth',
] as const satisfies readonly Audience[];
export const COSTS = ['free', 'low_cost', 'paid'] as const satisfies readonly Cost[];
/** Opportunities staff post by hand; everything else came from the data loader. */
export const MANUAL_SOURCE = 'manual';

// ── Public data (the data loader, docs/data-loader.md) ────────────────────────
export type IncidentPoint = Schemas['IncidentPoint'];
export type DispatchCall = Schemas['DispatchCall'];
export type TransitNearby = Schemas['TransitNearby'];
export type WeatherAlert = Schemas['WeatherAlert'];
export type CrimeTrendPoint = Schemas['CrimeTrendPoint'];
export type SourceHealth = Schemas['SourceHealth'];
export type DraftMessage = Schemas['DraftMessage'];
export type StaffStatus = Schemas['StaffStatus'];
export type StaffMember = Schemas['StaffMember'];
export type Worker = Schemas['Worker'];
export type UserSummary = Schemas['UserSummary'];
export type SubmitRequest = Schemas['SubmitRequest'];
export type PublicRequest = Schemas['PublicRequest'];
export type PublicRequestDetail = Schemas['PublicRequestDetail'];
export type PublicRequestUpdate = Schemas['PublicRequestUpdate'];
export type AnonymousRequestReceipt = Schemas['AnonymousRequestReceipt'];
export type ReplyRequest = Schemas['ReplyRequest'];
export type ContactMethod = Schemas['ContactMethod'];
export type Task = Schemas['Task'];
export type RouteRequest = Schemas['RouteRequest'];
export type RouteResponse = Schemas['RouteResponse'];
export type Service = Schemas['Service'];
/** The API's Record (a Phantom debrief); named so it doesn't shadow TypeScript's Record. */
export type DebriefRecord = Schemas['Record'];
export type RecordStatus = Schemas['RecordStatus'];
export type RecordStage = Schemas['RecordStage'];
export type Extraction = Schemas['Extraction'];
export type CreateRecord = Schemas['CreateRecordRequest'];
export type ConfirmRecord = Schemas['ConfirmRecordRequest'];
export type ConfirmedRecord = Schemas['ConfirmedRecord'];
export type JobStat = Schemas['JobStat'];
export type VoiceUpload = Schemas['VoiceUpload'];
export type TaskStatus = Schemas['TaskStatus'];
export type CreateTask = Schemas['CreateTaskRequest'];
export type UpdateTask = Schemas['UpdateTaskRequest'];
export type TaskFilters = NonNullable<operations['list_tasks_v1_tasks_get']['parameters']['query']>;
export type ClaimHandoff = Schemas['ClaimHandoffRequest'];
export type VoiceFollowUp = Schemas['VoiceFollowUp'];
export type VoiceReferralDetail = Schemas['VoiceReferralDetail'];
export type VoiceCallReview = Schemas['VoiceCallReview'];
export type VoiceCallReviewDetail = Schemas['VoiceCallReviewDetail'];
export type VoiceImpactSummary = Schemas['ImpactSummary'];
export type VoiceOutcomeStatus = Schemas['OutcomeStatus'];
export type RecordVoiceOutcome = Schemas['RecordOutcomeRequest'];

// The values the UI iterates, in display order. `satisfies` keeps them in
// step with the API's enums: a value the API drops fails the typecheck.
export const CASE_CATEGORIES = [
  'homelessness',
  'meal_programs',
  'transportation',
  'violence_prevention',
  'incident_deescalation',
  'missing_persons',
  'burial_assistance',
  'bridge_to_employment',
  'other',
] as const satisfies readonly CaseCategory[];
export const CASE_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const satisfies readonly CasePriority[];
export const CASE_STATUSES = ['new', 'in_progress', 'awaiting_resources', 'resolved', 'closed'] as const satisfies readonly CaseStatus[];
export const REFERRAL_STATUSES = ['suggested', 'shared', 'accepted', 'completed', 'declined'] as const satisfies readonly ReferralStatus[];
