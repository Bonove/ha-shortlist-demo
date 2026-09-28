# Demo script

Two walks that stand on their own. **Chapter one** follows one tenant through
four decisions and takes about five minutes; it is the demonstration. **Chapter
two** is the policy walk from S0 to S4 and takes about three; it is the "change
the policy, watch it move" story and can be shown on its own or after.

Presentation mode on, window at 1440px. Everything on screen is fictional
demonstration data.

Start with **S5 — the journey bundle** active. It is the only snapshot carrying
all four specs, so chapter one has nothing to execute without it. Chapter two
opens by activating S0 and ends by restoring.

---

## Chapter one — one tenant, four decisions

### 0:00 — The shortlist (30s)

Open **Tenant experience**. Alex needs a place in Amsterdam: five months, up to
€1,200 a month, about €2,500 up front.

> "I need a place in Amsterdam for five months, up to €1,200 a month, and I can
> pay about €2,500 up front."

Three homes come back with real numbers, and only **B — City Room** fits.

Keep this short and say why out loud: **this is the one moment where nobody can
disagree with the answer.** Everybody already accepts that search should filter.
The three moments after it are the ones where people currently disagree, and
they are what the rest of the demonstration is about.

Alex takes **A — Canal Studio** anyway, at €1,100 a month with a €2,200 deposit.
Open **Journey spine**.

### 0:30 — The contract (mission 02, 60s)

Select the contract moment. The question is whether this contract may be signed
as it is offered, and the engine says **no**.

The advert said €1,100. The contract costs **€1,185** a month, because it adds a
service charge of **€85** that the listing never mentioned. Point at the line
that says so, and at the rule name beside it.

This is worth naming: a "no" here is not a failure of the system, it is a normal
business answer. The contract is a perfectly ordinary contract; it simply does
not match what was advertised.

Now in **Change one fact**, set the service charge to **0** and press **Save and
re-run**. The monthly cost matches the advert and the decision flips.

### 1:30 — The renewal (mission 06, 90s)

Select the renewal moment. Alex is a year in at €1,100, and the agent is
proposing **€1,250**.

The engine caps the increase at **4.1%** for a liberalised contract, so the most
that may be asked is **€1,145.10**. The offer is above it and is declined.

Lower the proposed rent to something under the cap and re-run. The same offer,
made at a permitted amount, is allowed.

Now the important part. Change the contract type to **Student housing** and
re-run. The policy has no cap for student housing, so the engine returns **no
answer** — not a yes, not a no.

**Stop here and say it.** A system that answers "no" and a system that answers "I
cannot answer this" are different systems. The second one is the one you can put
in front of a tenant, because it never invents a number to fill a silence in the
policy. If this demonstration leaves one idea behind, it is this one.

Set the contract type back to liberalised.

### 3:00 — The date the rule comes into force (45s)

Find **Evaluation date** in the presenter bar and press **1 Jan 2027**.

The renewal cap drops from **4.1%** to **2.8%**, and the maximum rent falls with
it. The card names the dated version that answered.

Nobody activated anything and nobody edited anything. The new cap was published
in advance and came into force on its own date. That is how you announce a
change before it applies, and how you still answer "what did the policy say that
day?" a year later.

Press **Today** to come back.

### 3:45 — The deposit (mission 07, 60s)

Select the deposit moment. The tenancy is over, **€2,200** is held, and the
landlord claims **€600** for accidental damage with nothing to support it.

**€0** may be withheld and **€2,200** goes back. Nothing is chargeable without
evidence from both the move-in and the move-out record, and the engine says
which rule decided that.

Tick the evidence box and re-run: the deduction becomes **€600**.

Now change the category to **normal wear and tear** and re-run. It returns to
**€0** whatever the evidence says, because normal wear is not chargeable at all.
Evidence is the second question; chargeability is the first.

### 4:45 — Close (15s)

Same tenant, four decisions, one engine — and every figure on screen carries the
rule that produced it, the snapshot it came from and the date it was read at.

---

## Chapter two — the policy walk, S0 → S4

**S0 → S1 → S2 → S3 → S4 → restore.** About three minutes, or four with the
temporal chapter. This walk lives on the **Tenant experience** view.

### The problem (25s)

Go to **Rules Studio** and activate **S0 — baseline**. The three later moments
go quiet: S0 holds only the shortlist spec, and a moment with no spec to run
says so rather than showing a number.

On S0, only **B — City Room** fits. Open **"Why this result?"** on **A — Canal
Studio**.

The deposit is two months' rent, so the initial payment is
**€1,100 + €2,200 + €150 = €3,450**, which is €950 over what Alex has.

Scroll the panel to the provenance: snapshot id, source hash, LemmaBase
repository and publication revision. Expand the technical view — that is the
engine's actual explanation tree, not a narrative.

### S1: change a fee, not the assistant (20s)

Go to **Rules Studio**. Show the published source and the active snapshot.
Activate **S1 — lower booking fee**.

Back on the tenant view: every initial payment drops by €50.
A €3,400 · B €2,400 · C €2,200. Still only B fits.

Nothing about the assistant changed. The policy did.

### S2: the change that matters (35s)

Activate **S2 — deposit cap**. One extra `unless` line in the Lemma source caps
the up-front deposit at one month's rent.

A drops **€3,400 → €2,300** and turns green. Two homes now fit.

Ask the assistant:

> "What changed? Why does the Canal Studio work now?"

It explains from the fresh evaluation — the cap, the new deposit, the new initial
payment — and it can only do so because the harness re-evaluated first.

### S3: an approved exception (25s)

Activate **S3 — approved stay exception**. The Park Apartment is allowed to
accept a five-month stay.

C turns green. All three homes now fit. These are checks against Alex's stated
requirements, not judgements about Alex.

### S4: published, not yet in force (30s)

Activate **S4 — temporal fee change**. Nothing visible happens: the numbers stay
A €2,300 · B €2,400 · C €2,200.

Now press **1 Jan 2027** on the evaluation date.

Every initial payment drops by €100 — A €2,200 · B €2,300 · C €2,100 — and the
card reads *Version in force: 2027-01-01*. One published bundle, two dated
versions of the same policy, and the date decided which one answered.

Press **Today** to come back.

### Proof that nothing moves by itself (20s)

Still in Rules Studio, scroll to **LemmaBase connection** and press **Check
against LemmaBase**.

The repository currently publishes S3. The harness is running whatever you last
activated. The table shows both, side by side, and says *"The repository is
ahead… Nothing switched by itself."*

That is the whole governance argument in one screen: the policy can move without
the runtime moving, and you can see the gap rather than discover it.

### The audit view (20s)

Open **Change comparison**. Baseline plus every cumulative step, the real source
diff between steps, every listing at every step, and the difference from both the
previous step and the baseline — all computed against one frozen input set.

Note that inspecting a step here does **not** activate it.

### Restore and close (15s)

In Rules Studio, hit **Restore S0**. Everything returns to the baseline results.

Close on **"Continue with this home"** for B: the harness re-evaluates against
current data and the active snapshot before it will create the local
demonstration application. No booking, no payment, nothing sent.

---

## If something goes wrong on stage

- **Assistant shows "not connected"** — `OPENAI_API_KEY` is missing from `.env`.
  Journey spine, Rules Studio, Change comparison and all Lemma evaluation keep
  working; both walks can be told without the chat.
- **An evaluation shows "unavailable"** — that is the truthful failure state, not
  a mock. Say so; it is a feature of the design.
- **A card says "needs information"** — a scenario control has removed a deposit.
  Reset it from the scenario panel.
- **A moment says no answer when you did not expect it** — check the contract
  type or the claim category. Reset from **Reset to the starting facts**, which
  puts every fact of that moment back where the walk starts.
