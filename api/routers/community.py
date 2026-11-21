from fastapi import APIRouter, Depends, Query

from dependencies import get_community_service, get_current_user
from models.community import (
    AssistanceRequest,
    CatalogAnswer,
    CommunityPost,
    CreateAssistanceRequest,
    CreateCommunityPost,
    Opportunity,
    PublicResource,
)
from models.user import AppUser
from services.community import CommunityService

router = APIRouter(prefix="/community", tags=["community"])


@router.get("/resources", response_model=list[PublicResource])
async def resources(
    q: str | None = Query(default=None, max_length=120),
    category: str | None = Query(default=None, max_length=64),
    service: CommunityService = Depends(get_community_service),
) -> list[PublicResource]:
    return await service.resources(q, category)


@router.get("/assistant", response_model=CatalogAnswer)
async def assistant(
    q: str = Query(min_length=2, max_length=240),
    service: CommunityService = Depends(get_community_service),
) -> CatalogAnswer:
    return await service.answer(q)


@router.get("/opportunities", response_model=list[Opportunity])
async def opportunities(
    kind: str | None = Query(default=None, max_length=40),
    service: CommunityService = Depends(get_community_service),
) -> list[Opportunity]:
    return await service.opportunities(kind)


@router.get("/requests", response_model=list[AssistanceRequest])
async def my_requests(
    user: AppUser = Depends(get_current_user),
    service: CommunityService = Depends(get_community_service),
) -> list[AssistanceRequest]:
    return await service.requests(user.id)


@router.post("/requests", response_model=AssistanceRequest, status_code=201)
async def create_request(
    body: CreateAssistanceRequest,
    user: AppUser = Depends(get_current_user),
    service: CommunityService = Depends(get_community_service),
) -> AssistanceRequest:
    return await service.create_request(
        user.id,
        body.category,
        body.summary,
        body.neighborhood,
        body.contact_preference,
    )


@router.get("/feed", response_model=list[CommunityPost])
async def feed(service: CommunityService = Depends(get_community_service)) -> list[CommunityPost]:
    return await service.posts()


@router.post("/feed", response_model=CommunityPost, status_code=201)
async def create_post(
    body: CreateCommunityPost,
    user: AppUser = Depends(get_current_user),
    service: CommunityService = Depends(get_community_service),
) -> CommunityPost:
    return await service.create_post(user.id, body.body, body.neighborhood, body.anonymous)
