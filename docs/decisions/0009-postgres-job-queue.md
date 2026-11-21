# 0009 — Background work: a job queue in Postgres, run by a worker process

**Date:** 2026-11-22 · **Status:** accepted

## Context

Phantom (record → transcribe → extract, then a case) does slow, failure-prone
work: AI calls that take seconds and sometimes time out. That can't happen
inside an HTTP request, and it must survive crashes and redeploys: a
debrief about a domestic-violence situation can't be silently lost or
processed twice.

The production database is Supabase Postgres, reached through the
transaction pooler (port 6543). The pooler can't do LISTEN/NOTIFY or keep
session locks. The API runs in k8s from Terraform.

Options considered:

- **Redis with a worker library** (Celery, arq, RQ): new infrastructure to run
  and secure, and enqueueing can't share a transaction with the database
  write, so a crash between the two loses a job or leaves an orphan.
- **Supabase Queues (pgmq):** good, but our local Postgres image doesn't have
  it, and retries, leases and dead-lettering still have to be written.
- **Our own table with `FOR UPDATE SKIP LOCKED`:** no new infrastructure, the
  same locally and on Supabase, transactional with the rest of the data, and
  well past our volume (thousands of jobs a second; we expect hundreds of
  debriefs a day).

## Decision

A queue in Postgres (`app.jobs`, migration 0011), driven only through stored
functions like the rest of the API (ADR 0007), and a separate worker process
(`python -m worker`, the API's image, its own Deployment in
`terraform/worker.tf`).

- **Enqueue is transactional:** a record and its first job are written in
  one transaction (the outbox pattern), and a stage saves its result,
  completes its job and queues the next stage in one transaction.
- **Leases, not locks:** `job_claim` marks jobs running for
  `lease_seconds` and counts the attempt. A worker that dies lets the lease
  run out and the job is claimed again; a job that keeps killing its worker
  still ends up dead. Stage timeouts are shorter than the lease.
- **Owner checks:** `job_complete` and `job_fail` only act for the worker
  holding the lease, so a worker that lost its lease can't overwrite the
  newer attempt (its whole stage transaction rolls back).
- **Retries with backoff and a dead letter:** exponential backoff with
  jitter; an error marked `permanent` (unreadable audio) is dead at once;
  after `max_attempts` the job is dead and its stage marks the
  record failed so the author can retry. A sweeper fails records whose job
  died without telling them.
- **Idempotent stages:** a job for a record that moved on or was discarded
  does nothing; `dedupe_key` makes queueing the same work twice one job.
- **Polling:** workers poll (backing off to 5 s when idle) because the
  transaction pooler has no LISTEN/NOTIFY.
- **No content in the queue:** payloads carry ids; `last_error` holds the
  exception type or a message written to be safe, never the record's text.
- **Operations:** `GET /v1/jobs/stats` (admins) shows backlog and dead jobs;
  finished jobs are pruned after 7 days (dead ones after 28).

## Consequences

- Any number of worker replicas can run; SKIP LOCKED keeps them apart.
- Background work is tested against real Postgres
  (`api/tests/integration/test_jobs.py`, `test_record_pipeline.py`):
  concurrent claims, expired leases, a stale complete, dead-lettering.
- If volume ever outgrows Postgres, the queue sits behind `JobDatabridge` and
  the runner (`api/worker/runner.py`), so another backend is one adapter.
- Polling costs a cheap indexed query per worker every 1 to 5 seconds.
