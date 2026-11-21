"""The community resource directory: services people can be referred to.
Anyone signed in can browse it (the community app can show it too); staff
add to it."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from dependencies import get_case_service, get_current_user, get_current_worker
from models.case import CaseCategory, CreateResourceRequest, Resource
from models.staff import StaffMember
from models.user import AppUser
from services.case import CaseService

router = APIRouter(prefix="/resources", tags=["resources"])


@router.get("", response_model=list[Resource])
async def list_resources(
    q: Annotated[str | None, Query(max_length=200)] = None,
    category: CaseCategory | None = None,
    _: AppUser = Depends(get_current_user),
    service: CaseService = Depends(get_case_service),
) -> list[Resource]:
    """Active resources, real ones before samples. `q` matches the name,
    description or neighborhood. Rows with `is_sample: true` are
    demonstration data, not real services."""
    return await service.list_resources(q, category)


@router.get("/{resource_id}", response_model=Resource)
async def get_resource(
    resource_id: UUID,
    _: AppUser = Depends(get_current_user),
    service: CaseService = Depends(get_case_service),
) -> Resource:
    return await service.get_resource(resource_id)


@router.post("", response_model=Resource, status_code=status.HTTP_201_CREATED)
async def create_resource(
    body: CreateResourceRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> Resource:
    """Add a resource to the directory. Staff only."""
    return await service.create_resource(worker, body)
