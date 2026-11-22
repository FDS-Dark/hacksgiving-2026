"""Errors a client raises that the loader treats specially."""


class RateLimited(RuntimeError):
    """The server refused because this address asked too often. The loader
    records the attempt as rate limited and holds the source back for its
    backoff window (utils/rate_gate.py): retrying sooner only extends the
    limit, since every request counts."""
