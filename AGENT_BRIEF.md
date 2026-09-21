# Shared build brief — ha-shortlist-demo

Read this before writing any code. It records facts that were **verified by
running them**, not guessed. Do not re-derive them; do not contradict them.

Project root: `/Users/tristan/Documents/klanten/housing-anywhere/ha-shortlist-demo`

## What this prototype is

A presentation-quality prototype for HousingAnywhere showing an **agent harness**
that coordinates a live AI assistant, shared tenant context, demo listing data
and a **real local Lemma engine** executing policy source published to LemmaBase.

Scenario: "From search overload to a trusted shortlist." Tenant Alex, Amsterdam,
5 months, max €1,200/month, max €2,500 initial payment, prefers a short commute.

Initial payment = first month's rent + deposit + booking fee.

Everything is fictional demonstration data. Never imply it is real HousingAnywhere
policy or Dutch law.

## Non-negotiables

- All money maths and hard compatibility checks run through the **real Lemma
  engine**. No JavaScript reimplementation, no hardcoded results, no LLM maths.
- If the engine fails, show an explicit error. Never silently fall back to mocks.
- The live assistant explains results; it never invents numbers or verdicts, and
  it has **no policy-editing or publishing tools**.
- Enforcement lives in application code, not in a system prompt.
- Secrets stay server-side. Never in client bundles, logs or exports.

## Already done (do not redo)

1. Project scaffolded: Next.js 15 App Router, React 19, TypeScript, vitest.
   Deps pinned in `package.json`, lockfile committed.
2. `src/lib/contracts.ts` — **the shared type contract. Read it first.**
   Do not change it without saying so in your final report.
3. `src/lib/policy/hash.ts` — `hashBundle()`, the single bundle-hash definition.
4. `src/styles/globals.css` — design tokens and base classes. **Use these
   classes.** Do not introduce a CSS framework or a second token set.
5. `src/app/layout.tsx`, `src/components/nav.tsx` — app shell.
6. LemmaBase repository `@tristan-van-doorn/ha-shortlist-demo` created (private)
   and S0–S3 published, retrieved and captured under `policies/snapshots/<id>/`
   with `manifest.json` + `shortlist_policy.lemma`.
7. `scripts/verify-snapshots.mjs` reproduces the acceptance fixture from the
   captured published source. Run `node scripts/verify-snapshots.mjs` any time.

## Verified engine facts

`@lemmabase/lemma-engine@0.9.10`.

**Node cannot use `Lemma()`** — it fetches the wasm over `file://` and throws.
Initialise synchronously from disk instead:

```ts
import { initSync, Engine } from '@lemmabase/lemma-engine';
import { readFileSync } from 'node:fs';
initSync({ module: readFileSync('node_modules/@lemmabase/lemma-engine/lemma_bg.wasm') });
const engine = new Engine();
```

`initSync` must run **once per process**. Loading a spec twice into one `Engine`
is not how snapshots are isolated — construct a **new `Engine()` per loaded
bundle** and cache it by source hash.

- `await engine.load({ 'shortlist_policy.lemma': code })` returns `undefined`
  on success, or an array of `EngineError` objects on failure. **A falsy return
  means valid.** Errors carry `{ kind, message, source: { attribute, line,
  column, length }, suggestion }`.
- `engine.run({ spec, data, rules?, explain? })` returns
  `{ spec, effective, spec_effective_from, results }`.
- Each entry in `results` is `{ vetoed, rule_type, display, boolean?, measure?,
  calendar?, veto_reason?, missing_data?, explanation? }`.
  `explanation` appears **per rule** when `explain: true`, not at the top level.
- Values are passed as strings with units: `'1100 eur'`, `'5 month'`. Money comes
  back as `{ measure: { eur: '1100.00' } }` and `display: '1100.00 eur'`.
  Durations come back as `{ calendar: { value: '3', unit: 'month' } }`.
- Missing input → that rule is `vetoed: true` with
  `missing_data: ['requested_deposit']` and `veto_reason: 'Missing data: …'`.
  **This is "needs information", never zero.**
- `engine.source('lemma', 'units')` reads the embedded standard library.
- A runtime trap poisons the module; catch `RuntimeError` and re-`initSync` is
  not safe — surface the error instead.

## Verified Lemma language facts

- `month` and `year` are **reserved calendar units**; you cannot declare them in
  your own measure. Use `uses lemma units` and the type `units.calendar`.
- `units.duration` only accepts second…week, so it is wrong for stay length.
- Rules take no `->` constraints. Comments (`#`, `//`) do not exist.
- LemmaBase reformats published source canonically, so the text you retrieve
  after publishing is **not byte-identical to the draft you sent**. Always
  snapshot the *retrieved* text.

## The policy spec

Spec `shortlist_policy`, effective `2026-01-01`, one file
`shortlist_policy.lemma`. Inputs: `listing_reference`, `monthly_rent`,
`requested_deposit`, `listing_minimum_stay`, `intended_stay`,
`maximum_monthly_rent`, `maximum_initial_payment`.
Rules: `booking_fee`, `effective_deposit`, `initial_payment`,
`effective_minimum_stay`, `fits_monthly_budget`, `fits_initial_payment_budget`,
`meets_minimum_stay`, `offer_fits`.

## Acceptance fixture (already reproduced from published source)

Tenant: 5 months, max €1,200/month, max €2,500 up front.
Listings: A Canal Studio €1,100 / deposit 2 months / min 3 months / 10 min;
B City Room €1,150 / deposit 1 month / min 4 months / 25 min;
C Park Apartment €1,050 / deposit 1 month / min 6 months / 15 min.
Baseline booking fee €150.

| Snapshot | Cumulative state | A | B | C | Fits |
|---|---|---:|---:|---:|---|
| S0 | baseline | 3450 | 2450 | 2250 | B |
| S1 | + fee €100 | 3400 | 2400 | 2200 | B |
| S2 | + deposit capped at 1 month's rent | 2300 | 2400 | 2200 | A, B |
| S3 | + approved exception: C accepts 5 months | 2300 | 2400 | 2200 | A, B, C |

Independent scenario change: A's requested deposit 2 months → 1 month gives an
S0 initial payment of **€2,350**.

## Three identities, kept apart

- Application snapshot id — `S0`…`S3`, or a custom import.
- LemmaBase publication revision — e.g. `01a0c34d-d710-756b-941a-8e917af9a909`.
- Lemma temporal spec version — the `2026-01-01` effective date in the header.

They are never interchangeable. `source` can only fetch by *effective date*, not
by revision, so historical publications cannot be re-fetched — that is why each
publication was captured immediately.

## LemmaBase connectivity, stated honestly

The Claude Code MCP connection is a **development integration**. The running app
has no LemmaBase credentials by default and executes **stored published
snapshots**. The UI must say "using a stored published snapshot" rather than
implying a live connection. Do not render a fake "Publish to LemmaBase" button.

## File ownership

Touch only the paths assigned to you. If you need something outside them, define
it behind a type already in `contracts.ts` and say so in your report.

| Agent | Owns |
|---|---|
| lemma-core | `src/lib/lemma/**`, `src/lib/policy/**`, `src/app/api/policy/**`, `scripts/**` |
| harness | `src/lib/domain/**`, `src/lib/store/**`, `src/lib/harness/**`, `src/app/api/session/**`, `src/app/api/evaluate/**`, `src/app/api/scenario/**`, `src/app/api/application/**`, `src/app/api/status/**` |
| ai | `src/lib/ai/**`, `src/app/api/chat/**`, `src/components/chat/**` |
| tenant-ui | `src/app/page.tsx`, `src/components/tenant/**` |
| studio-ui | `src/app/rules-studio/**`, `src/app/comparison/**`, `src/components/studio/**`, `src/components/presenter-bar.tsx` |
| verify | `tests/**`, `README.md`, `DEMO-SCRIPT.md`, `ARCHITECTURE.md` |

## House style

- Lazy but complete: shortest code that fully does the job. No speculative
  abstractions, no interface with one implementation, no config for a constant.
- Comments explain *why*, never *what*. Match the density of `contracts.ts`.
- British-neutral English in all UI text, documentation and sample conversations.
- Server components by default; `'use client'` only where interaction needs it.
- Currency rendered as `€1,100` (no decimals when whole), amounts tabular.

## HTTP API contract (fixed — code against this, do not wait for each other)

**State ownership.** `lemma-core` owns policy state (snapshots, drafts, the
active pointer) in `data/policy-state.json`. `harness` owns tenant, listing,
session, chat and application state in `data/session.json`. The harness reads
the active snapshot by importing `getActiveSnapshot()` from
`src/lib/policy/snapshots.ts` — it never writes policy state.

### Policy — owned by `lemma-core`

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/policy/snapshots` | → `{ snapshots: PolicySnapshot[]; activeId; previousId }` (files without `code`) |
| GET | `/api/policy/snapshots/[id]` | → `PolicySnapshot` including full `code` |
| POST | `/api/policy/validate` | `{ files: PolicySourceFile[] }` → `ValidationResult` (isolated engine) |
| POST | `/api/policy/preview` | `{ files }` → `{ validation: ValidationResult; evaluation?: SnapshotEvaluation }` — evaluates the draft against the current frozen scenario without activating anything |
| POST | `/api/policy/activate` | `{ snapshotId }` → `{ activeId; previousId }` |
| POST | `/api/policy/restore` | `{ target: 'previous' \| 'S0' }` → `{ activeId; previousId }` |
| GET | `/api/policy/drafts` | → `PolicyDraft[]` |
| POST | `/api/policy/drafts` | `{ id?, name, basedOn, files }` → `PolicyDraft` |
| GET | `/api/policy/diff?from=S1&to=S2` | → `{ lines: { type: 'add' \| 'del' \| 'ctx'; text: string }[] }` (`from`/`to` accept a snapshot id; `to=draft:<id>` for a saved draft) |
| GET | `/api/policy/export?snapshotId=S2` | → downloadable bundle JSON `{ kind: 'lemma-policy-bundle', version: 1, snapshot: PolicySnapshot }` |
| POST | `/api/policy/import` | `{ bundle }` → `{ snapshot: PolicySnapshot }` or `400 { error, diagnostics }`. Verifies completeness, recomputes `sourceHash` and rejects a mismatch. Imported bundles get `provenance: 'import-metadata'`. **A failed import must leave the active snapshot untouched.** |

`preview` and `validate` must run in an **isolated** engine instance so an
invalid draft can never damage the active working snapshot.

### Harness — owned by `harness`

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/session` | → `{ session: SessionState; status: SystemStatus }` |
| POST | `/api/session/reset` | → `{ session }` |
| GET | `/api/status` | → `SystemStatus` |
| POST | `/api/evaluate` | `{ listingReferences?: string[] }` → `{ assessments: Assessment[] }`. Always re-runs the engine against the active snapshot and current revisions. |
| POST | `/api/scenario` | `{ tenant?: Partial<TenantProfile>; listing?: { reference: string; patch: Partial<Listing> } }` → `{ session; assessments }`. Bumps the relevant revision, invalidates stale assessments, re-evaluates. |
| POST | `/api/application` | `{ listingReference }` → `{ application: DemoApplication }` or `409 { error, assessment }` when the fresh re-evaluation does not fit. Creates a **local demonstration record only**. |
| POST | `/api/comparison` | `{ refreeze?: boolean }` → `{ scenario: ScenarioSnapshot; steps: SnapshotEvaluation[] }`. Evaluates **every** snapshot S0…S3 against one frozen input set. Never derives a later step from an earlier result. Inspecting this must not activate anything. |

### AI — owned by `ai`

| Method | Path | Notes |
|---|---|---|
| POST | `/api/chat` | `{ message: string }` → **SSE stream**. Events: `text` (`{ delta }`), `tool` (`{ name, input, output }`), `done` (`{ message: ChatMessage }`), `error` (`{ message }`). |

The live assistant runs on **OpenAI** (`openai` SDK, `OPENAI_API_KEY` and
`OPENAI_MODEL`, both server-side only). The brief originally said Anthropic; the
client corrected this. Nothing else about the assistant changed.
| GET | `/api/chat/status` | → `{ configured: boolean; model: string \| null; lastError: string \| null }` |

Assistant tools, all narrowly scoped and all server-side:
`get_tenant_profile`, `update_tenant_profile`, `find_listings`,
`evaluate_listings`, `explain_assessment`, `get_active_policy`.
There is deliberately **no** tool that edits or publishes policy, and no tool
that can mark an offer as fitting.

### Client data access

UI agents fetch these routes from client components. Poll nothing; refetch after
an action. A tiny shared hook may live in `src/components/use-session.ts`
(owned by `tenant-ui`, importable by the others).
