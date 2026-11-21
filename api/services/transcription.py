"""Speech to text for voice debriefs, with OpenAI's transcription model.
Runs in the worker (worker/stages via services/pipeline.py), never in a
request. The audio itself carries names to OpenAI; redaction happens after,
before the extraction model reads the text. The app says so."""

import logging

from openai import BadRequestError
from openai.resources.audio import AsyncAudio

logger = logging.getLogger(__name__)


class TranscriptionFailed(Exception):
    """No usable transcript. The message is safe to store (it never contains
    what was said). `permanent`: retrying can't help (unreadable audio,
    silence), so the queue gives up at once instead of trying five times."""

    def __init__(self, message: str, *, permanent: bool = False) -> None:
        super().__init__(message)
        self.permanent = permanent


class Transcriber:
    def __init__(self, audio: AsyncAudio, model: str) -> None:
        # `AsyncOpenAI().audio`; tests pass a fake with `transcriptions.create`.
        self.audio = audio
        self.model = model

    async def transcribe(self, audio: bytes, filename: str) -> str:
        try:
            result = await self.audio.transcriptions.create(
                model=self.model,
                file=(filename, audio),
                response_format="text",
                # Names, streets and services it should spell right.
                prompt="A ComForce MKE outreach worker's debrief in Milwaukee, Wisconsin.",
            )
        except BadRequestError:
            # The service read the file and refused it: the audio is the problem.
            logger.warning("OpenAI refused the recording (BadRequestError)")
            raise TranscriptionFailed("The recording couldn't be read. Record it again.", permanent=True) from None
        except Exception as error:
            logger.warning("OpenAI transcription call failed: %s", type(error).__name__)
            raise TranscriptionFailed(f"The transcription service didn't answer ({type(error).__name__}).") from None
        text = (result if isinstance(result, str) else getattr(result, "text", "")).strip()
        if not text:
            raise TranscriptionFailed("No speech was found in the recording.", permanent=True)
        return text
