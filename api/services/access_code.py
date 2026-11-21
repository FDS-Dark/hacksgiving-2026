"""Access codes for requests sent without an account. The person reads
theirs off the screen (or the app keeps it), so it is short and avoids
look-alike characters. Only its SHA-256 is stored; with the request number
and the per-IP rate limits, guessing one is impractical."""

import hashlib
import secrets

# No 0/O, 1/I/L: easy to read out and type. 31 symbols, 8 of them: ~40 bits.
ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
LENGTH = 8


def new_code() -> str:
    """Like K7QM-4XPA."""
    raw = "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))
    return f"{raw[:4]}-{raw[4:]}"


def normalize(code: str) -> str:
    """What the person typed, compared the way it was issued: case, spaces
    and dashes don't matter."""
    return "".join(ch for ch in code.upper() if ch.isalnum())


def hash_code(code: str) -> bytes:
    return hashlib.sha256(normalize(code).encode()).digest()
