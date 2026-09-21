# HousingAnywhere — trusted shortlist prototype

A clickable prototype showing an **agent harness** that coordinates a live AI
assistant, shared tenant context, demonstration listing data and a **real local
Lemma engine** executing policy source published to LemmaBase.

Scenario: *from search overload to a trusted shortlist.*

> All listings, prices and policies here are fictional demonstration data. They
> do not describe HousingAnywhere policy, pricing or Dutch law.

## Run it

```bash
npm install
cp .env.example .env     # then paste your OPENAI_API_KEY into .env
npm run dev              # http://localhost:3210
```

The application runs entirely on the captured published snapshots in
`policies/snapshots/`. It needs no connection to LemmaBase or Claude Code once
those are in place. Without an API key everything works except the live chat,
which says so plainly rather than falling back to a script.

```bash
npm test                          # the real-engine verification suite
node scripts/verify-snapshots.mjs # fixture check straight from published source
```

## The three views

- **Tenant experience** — the assistant, Alex's confirmed requirements, the
  listing cards with rent, deposit, fee, initial payment, minimum stay and travel
  time, "Why this result?", comparison and "Continue with this home".
- **Rules Studio** — the connected repository, the active snapshot and its source
  hash, publication metadata, a source viewer and editable local draft, real
  validation, diffs, impact preview, activation and snapshot history, plus bundle
  import and export.
- **Change comparison** — baseline and every cumulative policy change, the actual
  source differences, every listing at every step, and the deltas from both the
  previous step and the baseline, all against one frozen input set.

## The policy

Repository: **`@tristan-van-doorn/ha-shortlist-demo`** (private)
Spec: `shortlist_policy`, effective `2026-01-01`, one file
`shortlist_policy.lemma`.

Named rules: `booking_fee`, `effective_deposit`, `initial_payment`,
`effective_minimum_stay`, `fits_monthly_budget`, `fits_initial_payment_budget`,
`meets_minimum_stay`, `offer_fits`.

For this demonstration, **initial payment = first month's rent + deposit +
booking fee**.

### Captured publications

Each snapshot is the source **read back from the repository** after publishing,
not the draft that was sent to it.

| Snapshot | Cumulative policy state | LemmaBase revision |
|---|---|---|
| S0 | €150 fee; requested deposits; original minimum stays | `01a0c34d-d710-756b-941a-8e917af9a909` |
| S1 | S0 + booking fee reduced to €100 | `01a0c34e-733b-7d8a-9deb-0399e8f008c4` |
| S2 | S1 + deposit capped at one month's rent | `01a0c34e-bceb-7e8e-b8f8-fd2a30262520` |
| S3 | S2 + approved exception allowing five months for C | `01a0c34f-095e-7516-a8c5-ef5c39d4eaa4` |

Expected results for the seeded scenario (5 months, max €1,200/month, max €2,500
up front):

| Snapshot | A | B | C | Fits |
|---|---:|---:|---:|---|
| S0 | €3,450 | €2,450 | €2,250 | B |
| S1 | €3,400 | €2,400 | €2,200 | B |
| S2 | €2,300 | €2,400 | €2,200 | A, B |
| S3 | €2,300 | €2,400 | €2,200 | A, B, C |

## Editing a policy and getting it back into the app

The running app has no LemmaBase credentials and deliberately offers no
"Publish to LemmaBase" button. The supported round trip is:

1. **Edit** — in Rules Studio, change the local draft. It is labelled a local
   edit; it is not a published version.
2. **Validate and preview** — real diagnostics from the engine, and the impact on
   every listing, without activating anything.
3. **Export** — download the policy-source bundle from Rules Studio.
4. **Publish** — through the LemmaBase interface, or through Claude Code's
   LemmaBase MCP:
   ```
   publish(repository="@tristan-van-doorn/ha-shortlist-demo",
           path="shortlist_policy.lemma",
           code=<the edited source>,
           message="<what changed>")
   ```
5. **Retrieve** — read the published source back:
   ```
   source(repository="@tristan-van-doorn/ha-shortlist-demo",
          spec="shortlist_policy")
   ```
   Capture it immediately. The service can fetch by effective date, not by
   publication revision, so an older publication cannot be re-fetched later.
6. **Capture** — `node scripts/capture-snapshot.mjs <id> <step> <revision>
   "<label>" "<description>" "<message>" <retrieved-source-file>`
7. **Import and activate** — import the bundle in Rules Studio. It is verified
   for completeness and content hash before it can be activated, and a failed
   import leaves the active snapshot untouched.

Activation is always explicit. A newer publication never silently replaces the
policy the runtime is executing.

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the harness, where enforcement lives,
  and the three identities that are never interchangeable.
- [`DEMO-SCRIPT.md`](DEMO-SCRIPT.md) — the three-minute walkthrough.
- [`AGENT_BRIEF.md`](AGENT_BRIEF.md) — verified engine and language facts, the
  HTTP contract, and the build conventions.
