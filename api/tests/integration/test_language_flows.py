"""Replying in the resident's language, against real PostgreSQL with a fake
OpenAI: the case remembers a language the AI notices, a worker's choice
wins, drafts come with an English version, and replies translate."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from dependencies import get_case_assistant
from main import app
from models.assist import DraftOutput, TranslateOutput
from services.case_assist import CaseAssistant
from tests.helpers import auth_header


class FakeResponses:
    """Stands in for `AsyncOpenAI().responses`: answers by schema."""

    def __init__(self, detected: str = "es") -> None:
        self.detected = detected
        self.calls: list[dict] = []

    async def parse(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs["text_format"] is DraftOutput:
            spanish = "Spanish" in kwargs["instructions"] or self.detected == "es"
            out = DraftOutput(
                message="Hola, su viaje está reservado." if spanish else "Bonjour, votre trajet est réservé.",
                language="es" if spanish else self.detected,
                english="Hi, your ride is booked.",
            )
        else:
            out = TranslateOutput(text="Llamaremos mañana.")
        return SimpleNamespace(output_parsed=out)


@pytest.fixture
async def worker(api, admin_conn):
    headers = auth_header(f"auth0|{uuid4().hex}", name="Maria Santos")
    user_id = (await api.get("/v1/me", headers=headers)).json()["id"]
    await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", user_id)
    return headers


@pytest.fixture
def ai():
    responses = FakeResponses()
    assistant = CaseAssistant(responses, "test-model")  # type: ignore[arg-type]
    app.dependency_overrides[get_case_assistant] = lambda: assistant
    yield responses
    app.dependency_overrides[get_case_assistant] = lambda: None


async def test_the_draft_notices_the_language_and_the_case_remembers_it(api, worker, ai):
    case = (await api.post("/v1/cases", headers=worker, json={
        "title": "Viaje a diálisis", "description": "Necesito un viaje mañana.", "category": "transportation"})).json()
    assert (await api.get(f"/v1/cases/{case['id']}/language", headers=worker)).json()["language"] is None

    draft = await api.post(f"/v1/cases/{case['id']}/assist/draft-message", headers=worker)
    assert draft.status_code == 200, draft.text
    body = draft.json()
    assert body["language"] == "es" and body["message"].startswith("Hola")
    assert body["english"] == "Hi, your ride is booked."

    remembered = (await api.get(f"/v1/cases/{case['id']}/language", headers=worker)).json()
    assert remembered == {"language": "es", "language_name": "Spanish", "source": "detected"}

    # The next draft is written in it: the instructions name Spanish.
    await api.post(f"/v1/cases/{case['id']}/assist/draft-message", headers=worker)
    assert "Write it in Spanish." in ai.calls[-1]["instructions"]

    # A reply typed in English is translated into it.
    translated = await api.post(f"/v1/cases/{case['id']}/assist/translate", headers=worker,
                                json={"text": "We'll call tomorrow."})
    assert translated.json() == {"text": "Llamaremos mañana.", "language": "es"}


async def test_a_workers_choice_wins_over_detection(api, worker, ai):
    ai.detected = "fr"
    case = (await api.post("/v1/cases", headers=worker, json={"title": "Ride", "category": "transportation"})).json()
    chosen = await api.put(f"/v1/cases/{case['id']}/language", headers=worker, json={"language": "hmn"})
    assert chosen.json() == {"language": "hmn", "language_name": "Hmong", "source": "staff"}

    await api.post(f"/v1/cases/{case['id']}/assist/draft-message", headers=worker)
    assert "Write it in Hmong." in ai.calls[-1]["instructions"]
    assert (await api.get(f"/v1/cases/{case['id']}/language", headers=worker)).json()["source"] == "staff"

    unknown = await api.put(f"/v1/cases/{case['id']}/language", headers=worker, json={"language": "xx"})
    assert unknown.status_code == 422
    cleared = await api.put(f"/v1/cases/{case['id']}/language", headers=worker, json={"language": None})
    assert cleared.json()["language"] is None

    # English stays English, without asking the AI.
    calls = len(ai.calls)
    same = await api.post(f"/v1/cases/{case['id']}/assist/translate", headers=worker, json={"text": "Hello"})
    assert same.json() == {"text": "Hello", "language": "en"} and len(ai.calls) == calls

    languages = (await api.get("/v1/cases/languages", headers=worker)).json()
    assert {"code": "so", "name": "Somali"} in languages
