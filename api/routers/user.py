from fastapi import APIRouter, Depends

from dependencies import get_current_user, get_user_service
from models.user import AppUser, UpdateMeRequest
from services.user import UserService

router = APIRouter(prefix="/me", tags=["user"])


@router.get("", response_model=AppUser)
async def get_me(user: AppUser = Depends(get_current_user)) -> AppUser:
    """The signed-in user; the first call provisions them."""
    return user


@router.patch("", response_model=AppUser)
async def update_me(
    body: UpdateMeRequest,
    user: AppUser = Depends(get_current_user),
    service: UserService = Depends(get_user_service),
) -> AppUser:
    """Sets the caller's display name and/or IANA timezone. The app sends the
    name from the ID token after sign-in, since access tokens don't carry it.
    An email address is never kept as a name."""
    return await service.update(user, body.display_name, body.timezone)
