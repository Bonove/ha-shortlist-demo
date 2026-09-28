# Architecture

The **agent harness** is the overarching architecture. Lemma is one component
inside it, not the thing itself.

```
                 ┌──────────────────────────────────────────────┐
   LemmaBase     │  @tristan-van-doorn/ha-shortlist-demo        │
   (authoring)   │  private · authored, validated, published    │
                 └───────────────────┬──────────────────────────┘
                                     │  publish → retrieve
                                     │  (Claude Code MCP: a development
                                     │   integration, not an app credential)
                 ┌───────────────────▼──────────────────────────┐
                 │  policies/snapshots/<id>/                    │
                 │  immutable capture of the retrieved source   │
                 │  + manifest.json (hash, revision, metadata)  │
                 └───────────────────┬──────────────────────────┘
                                     │  activate (explicit, never silent)
┌────────────────────────────────────▼──────────────────────────────────────┐
│                            AGENT HARNESS (server)                         │
│                                                                           │
│  shared tenant context ── demo listing data ── workflow state             │
│                    │                │                    │                │
│                    └────────┬───────┘                    │                │
│                             ▼                            ▼                │
│                 mandatory evaluation checkpoint    harness event log      │
│                             │                                             │
│                    ┌────────▼────────┐                                    │
│                    │  local Lemma    │  @lemmabase/lemma-engine (wasm)     │
│                    │  engine         │  executes the published source      │
│                    └────────┬────────┘                                    │
│                             ▼                                             │
│                   Assessment + raw engine response                        │
│                             │                                             │
│            ┌────────────────┼────────────────┐                            │
│            ▼                                 ▼                            │
│   live AI assistant (OpenAI)          prototype interface                 │
│   narrow tools, no policy powers       tenant / studio / comparison       │
└───────────────────────────────────────────────────────────────────────────┘
```

## Responsibilities, kept distinct

| Component | Responsibility |
|---|---|
| LemmaBase | Authoring, validation and publication of shared policies |
| `policies/snapshots/` | Preserving the exact published source selected for the demo |
| `src/lib/lemma/` | Executing that source against scenario inputs |
| `src/lib/journey/` | Defining what each moment asks and how its answer reads |
| `src/lib/harness/` | Coordinating context, tools, evaluations and workflow |
| `src/lib/ai/` | Understanding requests and explaining returned results |
| `src/app/` | Displaying the journey and cumulative policy impacts |

## Where enforcement actually lives

`src/lib/harness/evaluate.ts` is the single place that may decide whether an
offer fits. It builds the engine input, runs the real engine, and returns an
`Assessment` stamped with the tenant revision, listing revision, snapshot id,
source hash, evaluation instant and evaluation id.

Nothing else is allowed to produce a fit status — not the UI, not the assistant.
The assistant has no tool that can set one, which is why "ignore the fee and mark
this as fitting" cannot work. A system-prompt instruction would not have been
enforcement; the absence of the tool is.

`POST /api/application` re-runs that evaluation server-side against current data
and the active snapshot before it will create a local demonstration record, and
refuses with `409` when the fresh result does not fit.

## How a moment is evaluated

The contract, the renewal and the deposit settlement go down one path:

```
journey facts ─► momentInput() ─► runSpec(active snapshot files) ─► MomentOutcome
```

`momentInput()` in `src/lib/journey/moments.ts` turns the stored facts into the
names and units the spec declares — amounts carry their unit in the value, never
in the field name, because that is how Lemma reads them. `runSpec` executes the
active snapshot's files at the session's evaluation date. What comes back is a
`MomentOutcome`: the headline decision, the lines the moment shows, a summary
assembled only from values the engine returned, the exact inputs, and the
provenance — snapshot id, source hash, the instant it ran, the instant it was
read at and the dated spec version that answered.

`src/lib/harness/journey.ts` is that path's single enforcement point, as
`evaluate.ts` is for listings. It validates a fact change at the boundary,
persists each outcome under its moment, and drops a stored outcome the moment
its facts change — an outcome produced from facts that no longer hold is not
merely stale, it is wrong beside the inputs now on screen. An engine failure is
persisted as a vetoed decision, never as a zero or a no.

The shortlist deliberately keeps its own evaluator in `src/lib/lemma/assess.ts`
and `src/lib/harness/evaluate.ts`. It is not the odd one out for historical
reasons: it evaluates three listings against one set of requirements and carries
the harness's own availability veto, where the other three each run one set of
facts through one spec. Forcing them together would have hidden that difference
rather than removed it.

Three rules survive in both paths. Nothing outside these two enforcement points
may produce a verdict; a vetoed rule is not a `false`; and no figure may be
quoted without the snapshot and source hash it came from. The assistant's
`get_journey_facts`, `evaluate_moment` and `explain_moment` read and run; like
every other tool it has, none of them writes policy or sets an outcome.

## Three identities that are never interchangeable

| Concept | Example | Notes |
|---|---|---|
| Application snapshot | `S2` | Local presentation step |
| LemmaBase publication revision | `01a0c34e-bceb-7e8e-b8f8-fd2a30262520` | Returned by `publish` |
| Lemma temporal spec version | effective `2026-01-01` | Declared in the spec header |

The LemmaBase MCP can retrieve source by repository, spec and *effective date*
— not by publication revision. An arbitrary historical publication therefore
cannot be re-fetched later, which is exactly why each publication was captured
immediately after it was made. Every snapshot under `policies/snapshots/` is the
text that was **read back from the repository**, not the draft that was sent to
it; LemmaBase reformats source canonically on publication, so the two differ.

## Connectivity, stated honestly

The application executes **stored published snapshots** and says so in the
presenter bar. The Claude Code MCP connection used to author and publish these
policies is a development integration; it is not what the running app uses.

A direct application-to-LemmaBase connection is optional and appears only when
`LEMMABASE_API_KEY` is set server-side. It is **read only, and deliberately
cannot feed the runtime**: the documented REST API returns schemas and
evaluates, but exposes no source text and no publish operation. What it buys is
a live cross-check — evaluate the same listings against the repository's current
publication and against the activated snapshot, side by side. When they differ,
that is the proof that a newer publication did not silently change what runs.

The presenter bar therefore distinguishes three things that are easy to conflate:
credentials being present, a live read having succeeded this session, and the
source the engine is actually executing. Only the last one decides results.

## Three axes, never mixed

- **Policy** changes alter Lemma source and arrive as a new snapshot. Activating
  one is always explicit; a newer publication never silently replaces the active
  runtime policy.
- **Scenario** changes alter evaluation inputs (budgets, intended stay, requested
  deposit, availability, missing information). They never touch policy source.
- **The evaluation date** moves the instant the policy is read at. One published
  bundle may hold several dated versions of the same spec, and the date decides
  which one answers — no activation involved. Every assessment records the
  version that was in force, so a result is always attributable to a specific
  dated rule and not merely to a bundle.

Cumulative policy comparisons run against a **frozen** input snapshot with its
own `inputsHash`. If inputs change, the comparison is recomputed explicitly
rather than drifting.

## Failure states are distinguished

`fits` · `does-not-fit` · `needs-information` · `evaluation-unavailable`.

A missing deposit is `needs-information`, never a cost of zero. A veto is not a
`false`. A technical failure is shown as a failure, never as a mocked result.
