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

The running application holds no LemmaBase credentials by default. It executes
**stored published snapshots** and says so in the presenter bar. The Claude Code
MCP connection used to author and publish these policies is a development
integration and does not give the application access to LemmaBase.

A direct application-to-LemmaBase read is optional and off unless
`LEMMABASE_API_KEY` is configured server-side.

## Policy changes versus scenario changes

Two separate axes, never mixed:

- **Policy** changes alter Lemma source and arrive as a new snapshot. Activating
  one is always explicit; a newer publication never silently replaces the active
  runtime policy.
- **Scenario** changes alter evaluation inputs (budgets, intended stay, requested
  deposit, availability, missing information). They never touch policy source.

Cumulative policy comparisons run against a **frozen** input snapshot with its
own `inputsHash`. If inputs change, the comparison is recomputed explicitly
rather than drifting.

## Failure states are distinguished

`fits` · `does-not-fit` · `needs-information` · `evaluation-unavailable`.

A missing deposit is `needs-information`, never a cost of zero. A veto is not a
`false`. A technical failure is shown as a failure, never as a mocked result.
