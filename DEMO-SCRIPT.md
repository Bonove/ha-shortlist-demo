# Three-minute demo script

**S0 → S1 → S2 → S3 → restore.** Presentation mode on, window at 1440px.

Everything on screen is fictional demonstration data.

---

### 0:00 — Set the scene (20s)

Open **Tenant experience**. Alex is looking for a place in Amsterdam: five
months, up to €1,200 a month, about €2,500 available up front, and a short
journey to university.

Type into the assistant, or use the suggested prompt:

> "I need a place in Amsterdam for five months, up to €1,200 a month, and I can
> pay about €2,500 up front."

The assistant confirms the requirements into shared context and asks the harness
to evaluate. Three homes come back with real numbers.

**Point at the presenter bar:** local Lemma engine, active snapshot **S0**, and
"using a stored published snapshot" — not a live LemmaBase connection.

### 0:35 — The problem (25s)

Only **B — City Room** fits. Open **"Why this result?"** on **A — Canal Studio**.

The deposit is two months' rent, so the initial payment is
**€1,100 + €2,200 + €150 = €3,450**, which is €950 over what Alex has.

Scroll the panel to the provenance: snapshot id, source hash, LemmaBase
repository and publication revision. Expand the technical view — that is the
engine's actual explanation tree, not a narrative.

### 1:00 — S1: change a fee, not the assistant (20s)

Go to **Rules Studio**. Show the published source and the active snapshot.
Activate **S1 — lower booking fee**.

Back on the tenant view: every initial payment drops by €50.
A €3,400 · B €2,400 · C €2,200. Still only B fits.

Nothing about the assistant changed. The policy did.

### 1:25 — S2: the change that matters (35s)

Activate **S2 — deposit cap**. One extra `unless` line in the Lemma source caps
the up-front deposit at one month's rent.

A drops **€3,400 → €2,300** and turns green. Two homes now fit.

Ask the assistant:

> "What changed? Why does the Canal Studio work now?"

It explains from the fresh evaluation — the cap, the new deposit, the new initial
payment — and it can only do so because the harness re-evaluated first.

### 2:00 — S3: an approved exception (25s)

Activate **S3 — approved stay exception**. The Park Apartment is allowed to
accept a five-month stay.

C turns green. All three homes now fit. These are checks against Alex's stated
requirements, not judgements about Alex.

### 2:25 — The audit view (20s)

Open **Change comparison**. Baseline plus every cumulative step, the real source
diff between steps, every listing at every step, and the difference from both the
previous step and the baseline — all computed against one frozen input set.

Note that inspecting a step here does **not** activate it.

### 2:45 — Restore and close (15s)

In Rules Studio, hit **Restore S0**. Everything returns to the baseline results.

Close on **"Continue with this home"** for B: the harness re-evaluates against
current data and the active snapshot before it will create the local
demonstration application. No booking, no payment, nothing sent.

---

## If something goes wrong on stage

- **Assistant shows "not connected"** — `OPENAI_API_KEY` is missing from `.env`.
  Rules Studio, Change comparison and all Lemma evaluation keep working; the
  whole policy story can be told without the chat.
- **An evaluation shows "unavailable"** — that is the truthful failure state, not
  a mock. Say so; it is a feature of the design.
- **A card says "needs information"** — a scenario control has removed a deposit.
  Reset it from the scenario panel.
