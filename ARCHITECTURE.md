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
