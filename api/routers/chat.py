"""Team chat (`/v1/chat`): the Team and On call channels and one per case.
Staff only; a case's channel is never shown to its resident. A channel is
named by its key: `team`, `oncall`, or the case's id."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from dependencies import get_chat_service, get_current_worker
from models.chat import ChatChannel, ChatMessage, ChatReadResult, ChatThread, SendChatMessageRequest
from models.staff import StaffMember
from services.chat import ChatService

router = APIRouter(prefix="/chat", tags=["chat"])

Worker = Annotated[StaffMember, Depends(get_current_worker)]
Service = Annotated[ChatService, Depends(get_chat_service)]


@router.get("/channels", response_model=list[ChatChannel])
async def list_channels(worker: Worker, service: Service) -> list[ChatChannel]:
    """Team and On call, then the case channels you belong to (assigned,
    opened, or wrote in) that have messages, with unread counts."""
    return await service.channels(worker)


@router.get("/channels/{key}", response_model=ChatThread)
async def get_thread(
    key: str,
    worker: Worker,
    service: Service,
    before: Annotated[datetime | None, Query(description="Only messages before this (older ones)")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> ChatThread:
    """The channel and its newest messages, oldest first. Doesn't mark it
    read: the app does that while the thread is on screen."""
    return await service.thread(worker, key, before, limit)


@router.post("/channels/{key}/messages", response_model=ChatMessage, status_code=status.HTTP_201_CREATED)
async def send_message(key: str, body: SendChatMessageRequest, worker: Worker, service: Service) -> ChatMessage:
    """Post to a channel. Members get an inbox row; with `rapid: true` they
    are also pushed ("New message in Team chat", never the text)."""
    return await service.send(worker, key, body)


@router.post("/channels/{key}/read", response_model=ChatReadResult)
async def mark_read(key: str, worker: Worker, service: Service) -> ChatReadResult:
    """You've read the channel up to now; its inbox rows are cleared."""
    return await service.read(worker, key)
