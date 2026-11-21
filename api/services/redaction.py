"""Takes names and direct contact details out of a record before the AI
reads it (Phantom's privacy rule; see docs/app-flow.md).

This is best effort and rule based, by design: an AI can't do it (the AI is
what we're keeping the names from), and a local NER model would mean
shipping a model in the worker image. The rules catch what people say
when they name someone ("named Maria", "her son Devon", "Ms. Jones",
"I'm Jordan") plus phone numbers and email addresses. They will miss a
bare name with no cue, so the app says "names we can spot are removed",
never "all names".

Addresses stay: the location is part of what staff need.
"""

import re
from typing import Protocol

NAME = "[name]"
PHONE = "[phone]"
EMAIL = "[email]"

# A capitalized word that looks like a name (Maria, O'Neil, Jean-Luc), and a
# second one for a surname.
_WORD = r"[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?"
_FULL = rf"{_WORD}(?:\s+{_WORD})?"

_TITLE = re.compile(rf"\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Officer|Pastor|Rev)\.?\s+{_FULL}")
# The cue is case-insensitive; the name itself must be capitalized, so
# "called back" or "this is serious" stay as they are.
_CUED = re.compile(
    rf"\b(?P<cue>(?i:named|called|name is|name's|i'm|i am|this is|goes by|known as))\s+(?P<name>{_FULL})"
)
# "her son Devon", "my sister Keisha", "their friend Ty"
_RELATION = re.compile(
    r"\b(?P<lead>(?i:my|her|his|their|our|your|the)\s+"
    r"(?:son|daughter|kid|child|boy|girl|brother|sister|mother|mom|father|dad|aunt|uncle|cousin|grandma|grandmother|"
    r"grandpa|grandfather|husband|wife|boyfriend|girlfriend|partner|ex|friend|neighbor|neighbour|roommate|baby|"
    r"nephew|niece))"
    rf"\s+(?P<name>{_FULL})"
)
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")
_PHONE = re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)")

# Words a cue can be followed by that aren't names ("this is Milwaukee
# Avenue", "I'm Fine"). Kept short and obvious; better to over-redact.
_NOT_NAMES = {
    "I", "A", "The", "Not", "So", "Just", "Here", "There", "Going", "Okay", "Ok", "Fine", "Good", "Sorry",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "Milwaukee", "ComForce",
}


class Redactor(Protocol):
    def redact(self, text: str) -> str: ...


class PatternRedactor:
    """The rules above. Deterministic, fast, and safe to run on every record."""

    def redact(self, text: str) -> str:
        out = _EMAIL.sub(EMAIL, text)
        out = _PHONE.sub(PHONE, out)
        out = _TITLE.sub(NAME, out)

        def cued(match: re.Match[str]) -> str:
            name = match.group("name")
            if name.split()[0] in _NOT_NAMES:
                return match.group(0)
            return f"{match.group('cue')} {NAME}"

        out = _CUED.sub(cued, out)

        def related(match: re.Match[str]) -> str:
            name = match.group("name")
            if name.split()[0] in _NOT_NAMES:
                return match.group(0)
            return f"{match.group('lead')} {NAME}"

        return _RELATION.sub(related, out)
