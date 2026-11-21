"""The data loader: a batch job that keeps imported opportunities and
resources current (docs/data-loader.md).

    python -m loader               every source that has its credentials
    python -m loader --dry-run     fetch and report, write nothing
    python -m loader --list        the sources and whether each can run
"""
