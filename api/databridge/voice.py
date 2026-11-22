import json
from datetime import datetime
from uuid import UUID

from databridge.base import Databridge
from models.voice import (
    ActiveReferral,
    ReferralFollowUp,
    ReferralFollowUpDue,
    SafeContactPlan,
    VoiceCheckpoint,
    ImpactCategory,
    ImpactSummary,
    VoiceReferral,
    ReferralOutcome,
    VoiceReferralStatus,
    VoiceResource,
    VoiceCall,
    VoiceCallEvent,
    VoiceCallReview,
    VoiceDashboard,
    VoiceFollowUp,
    VoiceReferralDetail,
)


class VoiceDatabridge(Databridge):
    async def resources(
        self, category: str | None, language: str | None
    ) -> list[VoiceResource]:
        rows = await self._rows(
            "voice_resource_list", category=category, language=language
        )
        return [VoiceResource(**row) for row in rows]

    async def checkpoint_resume(self, caller_hash: str) -> VoiceCheckpoint | None:
        row = await self._first("voice_checkpoint_resume", caller_hash=caller_hash)
        return VoiceCheckpoint(**row) if row else None

    async def contact_plan(self, call_id: UUID) -> SafeContactPlan | None:
        row = await self._first("voice_contact_plan_get", call_id=call_id)
        return SafeContactPlan(**row) if row else None

    async def add_case_contact_plan(
        self, case_id: UUID, plan: SafeContactPlan
    ) -> None:
        await self._rows(
            "voice_case_contact_plan_add",
            case_id=case_id,
            contact_method=plan.contact_method,
            safe_to_contact=plan.safe_to_contact,
            voicemail_allowed=plan.voicemail_allowed,
            neutral_message_only=plan.neutral_message_only,
            safe_contact_window=plan.safe_contact_window,
        )

    async def referral_follow_ups(
        self, *, user_id: UUID | None = None, call_id: UUID | None = None
    ) -> list[ReferralFollowUp]:
        return [
            ReferralFollowUp(**row)
            for row in await self._rows(
                "voice_referral_follow_up_list", user_id=user_id, call_id=call_id
            )
        ]

    async def due_follow_ups(self) -> list[ReferralFollowUpDue]:
        return [
            ReferralFollowUpDue(**row)
            for row in await self._rows("voice_referral_follow_up_due")
        ]

    async def ingest_call(
        self,
        *,
        conversation_id: str,
        event_timestamp: int,
        language: str | None,
        need_category: str | None,
        urgency_tier: str | None,
        neighborhood: str | None,
        callback_consent: bool,
        disposition: str | None,
        caller_hash: str | None,
        started_at: datetime | None,
        ended_at: datetime | None,
    ) -> VoiceCall:
        row = await self._one(
            "voice_call_ingest",
            conversation_id=conversation_id,
            event_timestamp=event_timestamp,
            language=language,
            need_category=need_category,
            urgency_tier=urgency_tier,
            neighborhood=neighborhood,
            callback_consent=callback_consent,
            disposition=disposition,
            caller_hash=caller_hash,
            started_at=started_at,
            ended_at=ended_at,
        )
        return VoiceCall(**row)

    async def call_by_conversation(self, conversation_id: str) -> VoiceCall | None:
        row = await self._first(
            "voice_call_get_by_conversation", conversation_id=conversation_id
        )
        return VoiceCall(**row) if row else None

    async def begin_call(self, conversation_id: str) -> VoiceCall:
        return VoiceCall(
            **await self._one("voice_call_begin", conversation_id=conversation_id)
        )

    async def append_event(
        self,
        *,
        call_id: UUID,
        event_key: str,
        event_type: str,
        details: dict[str, str | bool | int | None],
        occurred_at: datetime,
    ) -> VoiceCallEvent | None:
        row = await self._first(
            "voice_call_event_append",
            call_id=call_id,
            event_key=event_key,
            event_type=event_type,
            details=json.dumps(details, separators=(",", ":"), sort_keys=True),
            occurred_at=occurred_at,
        )
        return VoiceCallEvent(**row) if row else None

    async def create_referral(
        self, call_id: UUID, resource_slug: str, status: VoiceReferralStatus
    ) -> VoiceReferral | None:
        row = await self._first(
            "voice_referral_create",
            call_id=call_id,
            resource_slug=resource_slug,
            status=status,
        )
        return VoiceReferral(**row) if row else None

    async def create_handoff(
        self,
        call_id: UUID,
        code_hash: str,
        caller_hash: str | None,
        expires_at: datetime,
    ) -> datetime:
        row = await self._one(
            "voice_handoff_create",
            call_id=call_id,
            code_hash=code_hash,
            caller_hash=caller_hash,
            expires_at=expires_at,
        )
        stored_expiry = row["expires_at"]
        if not isinstance(stored_expiry, datetime):
            raise RuntimeError("voice_handoff_create returned an invalid expiry")
        return stored_expiry

    async def claim_handoff(
        self, code_hash: str, user_id: UUID
    ) -> VoiceFollowUp | None:
        row = await self._first(
            "voice_handoff_claim", code_hash=code_hash, user_id=user_id
        )
        return VoiceFollowUp(**row) if row else None

    async def follow_ups(self, user_id: UUID) -> list[VoiceFollowUp]:
        return [
            VoiceFollowUp(**row)
            for row in await self._rows("voice_follow_up_list", user_id=user_id)
        ]

    async def referrals_for_user(self, user_id: UUID) -> list[VoiceReferralDetail]:
        return [
            VoiceReferralDetail(**row)
            for row in await self._rows("voice_referral_list_for_user", user_id=user_id)
        ]

    async def referral_for_user(
        self, user_id: UUID, referral_id: UUID
    ) -> VoiceReferralDetail | None:
        row = await self._first(
            "voice_referral_get_for_user",
            user_id=user_id,
            referral_id=referral_id,
        )
        return VoiceReferralDetail(**row) if row else None

    async def call_reviews(self) -> list[VoiceCallReview]:
        return [
            VoiceCallReview(**row) for row in await self._rows("voice_call_review_list")
        ]

    async def call_review(self, call_id: UUID) -> VoiceCallReview | None:
        row = await self._first("voice_call_review_get", call_id=call_id)
        return VoiceCallReview(**row) if row else None

    async def referrals_for_call(self, call_id: UUID) -> list[VoiceReferralDetail]:
        return [
            VoiceReferralDetail(**row)
            for row in await self._rows("voice_referral_list_for_call", call_id=call_id)
        ]

    async def record_outcome(
        self, referral_id: UUID, status: str, reason_code: str | None
    ) -> ReferralOutcome | None:
        row = await self._first(
            "voice_referral_outcome_record",
            referral_id=referral_id,
            status=status,
            reason_code=reason_code,
        )
        return ReferralOutcome(**row) if row else None

    async def record_outcome_for_user(
        self, user_id: UUID, referral_id: UUID, status: str, reason_code: str | None
    ) -> ReferralOutcome | None:
        row = await self._first(
            "voice_referral_outcome_record_for_user",
            user_id=user_id,
            referral_id=referral_id,
            status=status,
            reason_code=reason_code,
        )
        return ReferralOutcome(**row) if row else None

    async def impact(self) -> ImpactSummary:
        summary = await self._one("voice_impact_summary")
        funnel = await self._one("voice_impact_funnel")
        rows = await self._rows("voice_impact_categories")
        return ImpactSummary(
            **summary, **funnel, categories=[ImpactCategory(**row) for row in rows]
        )

    async def dashboard(self) -> VoiceDashboard:
        return VoiceDashboard(
            stats=await self.impact(),
            active_referrals=[
                ActiveReferral(**row)
                for row in await self._rows("voice_active_referrals")
            ],
            routes=await self.resources(None, None),
        )
