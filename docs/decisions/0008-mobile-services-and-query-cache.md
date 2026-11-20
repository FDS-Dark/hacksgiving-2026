# 0008 — Mobile: domain services over TanStack Query, generated API types

> Inherited from Cooli, the project this repo's stack was copied from. The
> decision applies here; its examples name Cooli's domains (households,
> inventory, scans), which this repo doesn't have.

**Date:** 2026-11-13 · **Status:** accepted

## Context

Screens called a single `api` object directly and fetched with a
home-grown `useRequest` hook: no shared cache, no invalidation, so a tab
kept showing old stock after another tab changed it. The API's types were
copied by hand into `lib/types.ts`, and the household a request acted in
was a module-level variable.

## Decision

```
src/app/ (screens) and src/components/
  -> src/services/<domain>.ts   API calls, query keys, hooks, mutations
    -> src/api/client.ts        the one HTTP client (auth, errors, X-Household-Id)
       src/api/schema.ts        generated from the API's OpenAPI document
```

- **Screens use service hooks only** (`useLots`, `useRemoveStock`), never
  `request` or `fetch`.
- **TanStack Query is the cache.** Household-scoped keys start with
  `['household', <id>]`, so switching kitchens reads a different entry and
  a mutation refreshes what it changed (`invalidateStock`). Data refetches
  when the app returns to the foreground. Signing out clears the cache.
- **The household id is an argument**, passed by each service hook from
  `useHouseholdId()`; nothing global holds it.
- **Types are generated.** `api/scripts/export_openapi.py` writes
  `apps/mobile/openapi.json`; `npm run gen:api` turns it into
  `src/api/schema.ts`; `src/api/types.ts` names them. The API's `ApiModel`
  base marks response fields that have defaults as required, so a request
  field with a default is optional and a response field is not. CI fails
  when either generated file is stale.

## Consequences

- One cast remains, in `request<T>`: a response is trusted to match the
  schema the API itself published. CI keeps the two in step; there is no
  runtime validation.
- A new endpoint means: the API change, `export_openapi.py`, `gen:api`,
  then a service function and hook.
