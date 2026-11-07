# Automatic private progress sync — implementation draft

Status: PREPARED, NOT DEPLOYED. The existing Pista production application is
unchanged. No live database, authentication account or cloud synchronization has
been created. No real athlete progress has been uploaded.

## What exists

- `cloud-sync/engine.mjs`: automatic queue/merge engine with independently persisted
  pending operations, positive server acknowledgements, retry and logical clocks.
- `cloud-sync/supabase-transport.mjs`: adapter for an authenticated official Supabase
  client; Realtime notifications trigger a re-read and periodic reads recover
  missed notifications. It does not authenticate or provision an account.
- `supabase/migrations/202611070001_pista_progress.sql`: unapplied SQL draft for
  member-restricted progress, row-level access control and an atomic merge RPC.
- `tests/cloud-sync.test.mjs`: local tests against an in-memory canonical server,
  not evidence of a live Supabase or real-browser synchronization test.

## Access and zero-cost constraints

Use ONLY a confirmed Free organization/project. Do not create a project in a paid
organization, activate paid add-ons, add a payment method, or deploy Railway
resources. The currently connected GitHub account is not authorization to manage
an unconnected Supabase account. A Supabase connection was suggested but has not
been confirmed.

Provision only one authenticated athlete. Disable public sign-up, and insert her
Auth UID into `pista_members` using a privileged provisioning context. No frontend
service-role/management secrets, public progress JSON, anonymous write policy or
public shared password. A portable personal access link, if selected, is a secret
and must never be committed, logged, included in analytics or put in screenshots.
A new device must use the same identity/access link. Identity cannot be inferred
from an unrelated new browser merely because the app URL is the same.

Supabase Free currently lists $0/month, 500 MB database storage, two active projects,
and pausing after one week of inactivity. Do not promise unconditional uninterrupted
availability. Source checked 2026-11-07: https://supabase.com/pricing

## Still required before a release

1. Confirm the account connection and a genuinely Free project slot/organization.
2. Apply and test the migration; verify unauthorized users, anonymous requests and
   a second authenticated account cannot read or mutate the athlete's rows.
3. Provision the single athlete's access without exposing admin credentials.
4. Bundle a pinned official Supabase client locally and add only its public project
   URL/publishable key to configuration. Update the CSP/release asset manifest.
5. Wire the engine into app.js: whole-workout done/undone and notes, startup read,
   visibility/online refresh, real status text, no manual backup as the primary flow.
6. Migrate existing local progress conservatively: remote truth first. Never upload
   empty/default state from a fresh device over an existing cloud state. Do not seed
   automatically without an explicit atomic server-side first-import policy.
7. Preserve the old local data and any completedAt metadata. The draft sync schema
   currently synchronizes `done` and `note` only; plan editing and completion-history
   timestamps still need separate integration. `toProgress` produces patch values,
   not an instruction to replace every existing local progress field.
8. Test two distinct real browser storage contexts against the actual server,
   offline recovery, a lost response, live Realtime updates, app-version migration,
   a genuinely new device, authentication expiry and storage refusal.
9. Build/version and deploy only after those tests. Do not claim sync is live before
   observing it on the deployed app.

## Merge behavior and limitations

Each workout has independent done/note registers ordered by `(logical clock,
actor UUID)`. Different fields merge. Concurrent edits of the SAME field converge
deterministically; this is not conflict-free preservation of every text edit and
not a real-world timestamp ordering. A stale offline edit may be superseded by a
newer logical version. Before production, decide how to retain/surface superseded
note text so it is not silently lost.

Pending edits survive an ordinary app update/restart with browser storage intact.
They cannot reach a new device before the server has acknowledged them. Destroying
the only device before an offline edit has synchronized cannot be recovered by
cloud code; UI must say "Nur auf diesem Gerät / wartet auf Internet" until ack.

No keepalive jobs or unrelated paid infrastructure were created. Existing main and
gh-pages must stay on the last verified working release until deployment is ready.

## Reference API contracts

https://supabase.com/docs/guides/realtime/postgres-changes
https://supabase.com/docs/guides/database/postgres/row-level-security

Run local checks with:
`node --test tests/cloud-sync.test.mjs`
