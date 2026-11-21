from uuid import UUID

from databridge.community import CommunityDatabridge
from models.community import AssistanceRequest, CatalogAnswer, CommunityPost, Opportunity, PublicResource


class CommunityService:
    def __init__(self, community: CommunityDatabridge) -> None:
        self.community = community

    async def resources(self, query: str | None, category: str | None) -> list[PublicResource]:
        return await self.community.resources(query.strip() if query else None, category)

    async def answer(self, question: str) -> CatalogAnswer:
        normalized = question.strip().lower()
        emergency_terms = (
            "immediate danger",
            "weapon",
            "shots fired",
            "overdose",
            "fire",
        )
        emergency = any(term in normalized for term in emergency_terms)
        resources = await self.community.resources(question.strip(), None)
        if emergency:
            return CatalogAnswer(
                answer=(
                    "This may be an emergency. Leave the app and call 911 now. "
                    "Nearby catalog matches are shown only as additional information."
                ),
                resources=resources[:3],
                emergency=True,
            )
        if resources:
            names = ", ".join(resource.name for resource in resources[:3])
            return CatalogAnswer(
                answer=f"These verified Milwaukee resources may help: {names}.",
                resources=resources[:5],
            )
        return CatalogAnswer(
            answer=(
                "I could not find a close catalog match. Call 211 for a trained "
                "resource navigator, or 911 for immediate danger."
            ),
            resources=[],
        )

    async def opportunities(self, kind: str | None) -> list[Opportunity]:
        return await self.community.opportunities(kind)

    async def create_request(
        self,
        user_id: UUID,
        category: str,
        summary: str,
        neighborhood: str | None,
        contact_preference: str,
    ) -> AssistanceRequest:
        return await self.community.create_request(user_id, category, summary, neighborhood, contact_preference)

    async def requests(self, user_id: UUID) -> list[AssistanceRequest]:
        return await self.community.requests(user_id)

    async def posts(self) -> list[CommunityPost]:
        return await self.community.posts()

    async def create_post(
        self,
        user_id: UUID,
        body: str,
        neighborhood: str | None,
        anonymous: bool,
    ) -> CommunityPost:
        return await self.community.create_post(user_id, body, neighborhood, anonymous)
