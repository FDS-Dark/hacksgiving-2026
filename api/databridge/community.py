from uuid import UUID

from databridge.base import Databridge
from models.community import AssistanceRequest, CommunityPost, Opportunity, PublicResource


class CommunityDatabridge(Databridge):
    async def resources(self, query: str | None, category: str | None) -> list[PublicResource]:
        rows = await self._rows(
            "public_resource_search", query=query, category=category
        )
        return [PublicResource(**row) for row in rows]

    async def opportunities(self, kind: str | None) -> list[Opportunity]:
        return [Opportunity(**row) for row in await self._rows("public_opportunity_list", kind=kind)]

    async def create_request(
        self, user_id: UUID, category: str, summary: str, neighborhood: str | None, contact_preference: str
    ) -> AssistanceRequest:
        row = await self._one(
            "assistance_request_create",
            user_id=user_id,
            category=category,
            summary=summary,
            neighborhood=neighborhood,
            contact_preference=contact_preference,
        )
        return AssistanceRequest(**row)

    async def requests(self, user_id: UUID) -> list[AssistanceRequest]:
        return [AssistanceRequest(**row) for row in await self._rows("assistance_request_list_mine", user_id=user_id)]

    async def posts(self) -> list[CommunityPost]:
        return [CommunityPost(**row) for row in await self._rows("community_post_list")]

    async def create_post(
        self, user_id: UUID, body: str, neighborhood: str | None, anonymous: bool
    ) -> CommunityPost:
        row = await self._one(
            "community_post_create",
            user_id=user_id,
            body=body,
            neighborhood=neighborhood,
            anonymous=anonymous,
        )
        return CommunityPost(**row)
