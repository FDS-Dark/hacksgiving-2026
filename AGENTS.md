# Hacksgiving: notes for coding agents

ComForce MKE's app: a FastAPI backend (`api/`), a batch data loader
(`dataloader/`), Postgres migrations (`database/`), and an Expo app
(`apps/mobile/`) with a resident side and a staff side. Each person runs the whole stack on their own machine and tests
on their own phone with Expo Go.

**Picking up the work?** Read `docs/handoff.md` first: what's built, what's
half deployed, what's unverified, and what's next.

## Run it locally

Do these in order; each step ends on a check.

1. **Tools.** Docker (running), `uv`, Node 22, and ideally Tailscale up.
   Done when `docker info`, `uv --version` and `node --version` all succeed.
2. **Setup.** From the repo root: `scripts/dev-setup.sh`. It creates or
   completes `database/.env`, `api/.env`, `dataloader/.env` and
   `apps/mobile/.env.local` (adding
   only missing or placeholder values, never overwriting), fills in this
   machine's Tailscale or LAN IP for the phone, starts Postgres and the local
   storage container, runs the migrations and installs dependencies. Re-run it
   after any pull that touches env examples, migrations or dependencies.
   Done when it ends with "Still to do" and you have handled every line it
   prints there (see Gotchas).
3. **Run.** `scripts/dev.sh` starts the API, the background worker, the data
   loader and Expo together; Ctrl+C stops all of them. Done when all of these hold:
   - `curl http://localhost:8000/v1/health` returns `{"status":"healthy"}`
   - `curl http://localhost:8090/` returns `ok` (the worker)
   - Expo prints a QR code with an `exp://<this machine's IP>:8081` URL
4. **Phone.** Scan the QR code, sign in with a test account from
   `docs/test-accounts.md`. Done when the app opens past sign-in: staff
   accounts land on Today, residents on Home.

## Gotchas

- **OpenAI key.** `APP__OPENAI__API_KEY` in `api/.env` is the one value a
  person supplies; it is never in git. Without it the worker runs only task
  reminders: debriefs sit at "processing" and then fail, and "Suggest" on New
  case errors.
- **Sign-in callback per IP.** Auth0 only accepts Expo Go redirects it knows:
  `exp://<IP>:8081/--/auth` must be in `dev_callback_urls` in
  `auth0/terraform/variables.tf` (CI applies it on `main`). Tailscale IPs are
  stable, so that's what the list holds. A redirect or "callback URL mismatch"
  error at sign-in means this line is missing.
- **The phone uses this machine's IP**, never `localhost`: for the API
  (`EXPO_PUBLIC_API_BASE_URL`), Expo (`REACT_NATIVE_PACKAGER_HOSTNAME`) and
  voice uploads (`APP__STORAGE__PUBLIC_ENDPOINT_URL`). Setup fills all three;
  if the IP changes, set them again (or `HACKSGIVING_DEV_IP=<ip> scripts/dev-setup.sh`
  after clearing them).
- **401 from every API call** means the API checks a different kind of token
  than the app sends. The team default is Auth0 (`APP__JWT__ALGORITHM=RS256`
  plus the JWKS URL, issuer and audience in `api/example.env`).
- **Ports:** API 8000, Expo 8081, worker health 8090, storage 8333,
  Postgres 5432. Containers are named `hacksgiving-postgres` and
  `hacksgiving-storage`: one stack per machine.
- **Local storage keys** in the example env files are shared on purpose: they
  only unlock each person's own container. Real secrets (OpenAI, Auth0
  secrets, production keys) live in `.env` files, which are gitignored, or
  in Vault for deployments; keep them out of commits.

## Changing the code

Read the doc for the area before editing it:

- `api/README.md`: the backend's layering (router -> service -> databridge ->
  SQL in stored functions), how to add a resource, background jobs (Phantom).
- `docs/data-loader.md` (and `dataloader/README.md`): the data loader, its
  sources, and the rate gate that keeps MPD from blocking our shared IP.
- `apps/mobile/README.md` and `apps/mobile/AGENTS.md`: the app's structure
  (one service module per API domain) and Expo SDK specifics.
- `database/README.md`: migrations. A new revision takes the next number after
  the latest one on `origin/main` (teammates add them too), and an applied
  revision is never edited.
- `docs/app-flow.md` (what's built and planned) and `docs/decisions/` (ADRs).

Before calling a change done, the checks for each area you touched pass:

- API: `cd api && uv run flake8 . && uv run mypy . && uv run pytest`
- Data loader: `cd dataloader && uv run flake8 . && uv run mypy . && uv run pytest`
- App: `cd apps/mobile && npx tsc --noEmit && npm run lint && npx jest`
- Terraform: `tofu -chdir=<root> fmt -check -recursive && tofu -chdir=<root> validate`
