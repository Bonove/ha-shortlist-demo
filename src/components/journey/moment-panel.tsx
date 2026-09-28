'use client';

import type { MomentLine, MomentOutcome } from '@/lib/contracts';
import type { MomentDefinition } from '@/lib/journey/moments';
import { Mark } from '@/components/tenant/listing-card';
import './moment-panel.css';

/**
 * Four answers, not three: an engine that refuses is saying something different
 * from an engine that says no, and both differ from a rule that returned
 * nothing at all. Collapsing any of them into the others is the whole failure
 * this panel exists to avoid.
 */
type Verdict = 'allowed' | 'refused' | 'no-answer' | 'no-result';

function verdictOf(decision: MomentOutcome['decision']): Verdict {
  if (decision.vetoed) return 'no-answer';
  if (decision.passed === true) return 'allowed';
  if (decision.passed === false) return 'refused';
  return 'no-result';
}

const VERDICT_META: Record<Verdict, { cls: string; head: string }> = {
  allowed: { cls: 'verdict-allowed', head: 'Allowed' },
  refused: { cls: 'verdict-refused', head: 'Not allowed' },
  'no-answer': { cls: 'verdict-noanswer', head: 'No answer available' },
  'no-result': { cls: 'verdict-unknown', head: 'No result' },
};

/** Short enough to read aloud, long enough to tell two bundles apart. */
const shortHash = (hash: string) => hash.slice(0, 12);

function Prov({ k, v, className }: { k: string; v: string; className?: string }) {
  return (
    <div className={className}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

function Line({ line }: { line: MomentLine }) {
  const decision = line.kind === 'decision';
  const missing = line.missingData && line.missingData.length > 0;

  /* The engine already formatted every amount, ratio and duration. This panel
     prints that string and never recomputes it, so a rounding rule can only
     live in the policy. */
  const value = line.vetoed
    ? 'no answer'
    : missing
      ? 'not available'
      : decision
        ? line.passed === true
          ? 'passed'
          : line.passed === false
            ? 'not met'
            : 'no result'
        : (line.display ?? 'no value');

  return (
    <div className="line-row">
      {decision && !line.vetoed && !missing && <Mark passed={line.passed} />}
      <div className="grow">
        <strong style={{ fontWeight: 600 }}>{line.label}</strong>
        <span className="mono muted line-rule">{line.rule}</span>
        {line.vetoed && (
          <p className="line-note">
            Vetoed{line.vetoReason ? `: ${line.vetoReason}` : ''}. No value was produced for this line.
          </p>
        )}
        {missing && (
          <p className="line-note">
            Not evaluated — these inputs were never bound: {line.missingData?.join(', ')}. That is an unknown, not a
            zero.
          </p>
        )}
      </div>
      <span className="line-value" data-missing={line.vetoed || missing || (!decision && line.display === null)}>
        {value}
      </span>
    </div>
  );
}

/**
 * One moment of the journey: the question asked, the answer the engine gave,
 * every rule that contributed to it, the facts it was handed, and the published
 * bundle it came out of. Nothing on this panel is written from a guess, and
 * nothing is recalculated here — the display strings are the engine's own.
 */
export function MomentPanel({
  definition,
  outcome,
  stale,
}: {
  definition: MomentDefinition;
  outcome: MomentOutcome | undefined;
  stale: boolean;
}) {
  const head = (
    <div className="moment-head">
      <h2>{definition.question}</h2>
      <span className="pill pill-accent">
        Mission {definition.mission} · {definition.phase}
      </span>
    </div>
  );

  if (!outcome) {
    return (
      <section className="card card-pad col" style={{ gap: 14 }} aria-label={definition.question}>
        {head}
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          This moment has not been run yet. Nothing is shown because nothing has been decided — the{' '}
          <span className="mono">{definition.spec}</span> spec has not been given these facts.
        </p>
      </section>
    );
  }

  const verdict = verdictOf(outcome.decision);
  const meta = VERDICT_META[verdict];

  return (
    <section className="card card-pad col" style={{ gap: 16 }} aria-label={definition.question}>
      {head}

      {stale && (
        <div className="notice notice-warn">
          The facts or the policy have moved on since this answer was produced. It is shown as it was returned, but it
          needs re-running before anyone relies on it.
        </div>
      )}

      <div className={`verdict ${meta.cls}`}>
        <div className="grow">
          <p className="verdict-head">{meta.head}</p>
          <p style={{ fontSize: 14, marginTop: 2 }}>{outcome.decision.label}</p>
          <span className="mono muted verdict-rule">{outcome.decision.rule}</span>

          {verdict === 'no-answer' && (
            <>
              {outcome.decision.vetoReason && <p className="verdict-quote">“{outcome.decision.vetoReason}”</p>}
              <p className="verdict-note">
                This is not a refusal. The policy holds no rule that prices this case, so the engine declines to answer
                rather than guessing at one. A “no” would be a decision; this is the absence of one.
              </p>
            </>
          )}

          {verdict === 'no-result' && (
            <p className="verdict-note">
              The rule returned no outcome for this run — it was neither met nor failed. Treat it as unanswered, not as
              a pass.
            </p>
          )}
        </div>
      </div>

      <p className="moment-summary">{outcome.summary}</p>

      {outcome.lines.length > 0 && (
        <div className="moment-lines">
          {outcome.lines.map((line) => (
            <Line key={line.rule} line={line} />
          ))}
        </div>
      )}

      <details className="tech">
        <summary>Facts handed to the engine</summary>
        <div className="moment-inputs">
          {Object.entries(outcome.inputs).map(([k, v]) => (
            <div key={k}>
              <span className="k">{k}</span>
              <span className="v">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
            </div>
          ))}
        </div>
      </details>

      <div className="moment-prov">
        <Prov k="Snapshot" v={outcome.snapshotId} />
        <Prov k="Source hash" v={shortHash(outcome.sourceHash)} />
        <Prov k="Spec" v={outcome.spec} />
        <Prov k="Evaluated at" v={outcome.evaluatedAt} />
        <Prov k="Effective instant" v={outcome.effective} />
        {/* One published bundle can hold several dated versions; the effective
            instant picks one, and nobody activates anything to make it happen. */}
        {outcome.specEffectiveFrom && (
          <Prov
            className="prov-effective"
            k="Spec version in force"
            v={`Effective from ${outcome.specEffectiveFrom} — the dated version of the policy that the effective instant above selected.`}
          />
        )}
      </div>
    </section>
  );
}
