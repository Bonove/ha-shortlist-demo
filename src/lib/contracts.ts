/**
 * Shared contracts for the HousingAnywhere shortlist prototype.
 *
 * Every module in this app talks through the types in this file. It is the one
 * place that may be read by all the others; nothing here imports anything else.
 *
 * Three separate identities are deliberately kept apart and must never be
 * treated as interchangeable:
 *
 *   1. SnapshotId        — an application snapshot ("S0".."S3", or a custom one)
 *   2. PublicationRecord — a LemmaBase publication/revision of that source
 *   3. spec effective    — the Lemma temporal version date inside the source
 */

/* ------------------------------------------------------------------ policy */

/** Application-level snapshot identifier. Not a LemmaBase revision. */
export type SnapshotId = string;

/** One file inside an executable policy source bundle. */
export interface PolicySourceFile {
  /** Workspace path as published, e.g. "shortlist_policy.lemma". */
  path: string;
  /** Raw Lemma source text, exactly as retrieved. */
  code: string;
}

/** How the provenance of a bundle was established. */
export type ProvenanceVerification =
  /** Source text was read back from LemmaBase after publishing. */
  | 'live-repository-read'
  /** Provenance came from an imported bundle's own metadata. */
  | 'import-metadata'
  /** Local draft: never published, never provenance-verified. */
  | 'local-draft';

export interface PublicationRecord {
  /** Registry path, e.g. "@tristan-van-doorn/ha-shortlist-demo". */
  repository: string;
  /** Web URL for "Open in LemmaBase". */
  repositoryUrl: string;
  /** Spec name inside the repository. */
  spec: string;
  /** ISO timestamp at which this source was retrieved from LemmaBase. */
  retrievedAt: string;
  /** Publication message passed to LemmaBase, when known. */
  message?: string;
  /** Temporal effective date declared in the spec header (not a revision id). */
  specEffectiveFrom?: string;
  /**
   * Any revision/version identifier the service exposed. Undefined means the
   * service does not expose one — do not invent it.
   */
  revision?: string;
}

/**
 * An immutable local snapshot of an executable policy source bundle.
 * Stored on disk under policies/snapshots/<id>/manifest.json.
 */
export interface PolicySnapshot {
  id: SnapshotId;
  /** Short presenter-facing label, e.g. "S2 — deposit capped at one month". */
  label: string;
  /** One sentence describing the cumulative policy state. */
  description: string;
  /** Ordinal for the S0→S3 presentation walk; custom drafts get null. */
  step: number | null;
  files: PolicySourceFile[];
  /** sha256 over the canonicalised bundle. See hashBundle(). */
  sourceHash: string;
  provenance: ProvenanceVerification;
  publication?: PublicationRecord;
  /** When this snapshot was written locally. */
  capturedAt: string;
}

/** A local, unpublished edit. Never labelled published. */
export interface PolicyDraft {
  id: string;
  name: string;
  /** Snapshot this draft was branched from. */
  basedOn: SnapshotId;
  files: PolicySourceFile[];
  updatedAt: string;
}

export interface ValidationDiagnostic {
  kind: string;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  diagnostics: ValidationDiagnostic[];
}

/* ------------------------------------------------------------------ domain */

export interface Listing {
  /** Stable reference used by the policy source, e.g. "A". */
  reference: string;
  name: string;
  neighbourhood: string;
  /** Whole euro amount. */
  monthlyRent: number;
  /**
   * Deposit the advertiser asks for, in months of rent.
   * null means the advertiser has not stated it — never treat that as zero.
   */
  requestedDepositMonths: number | null;
  /** Minimum stay in whole months. */
  minimumStayMonths: number;
  /** Demonstration travel time to the university, in minutes. */
  travelMinutesToUniversity: number;
  availableForRequestedDates: boolean;
  imageHue: number;
  /** Bumped whenever listing data changes, for evaluation staleness checks. */
  revision: number;
}

export interface TenantProfile {
  name: string;
  city: string;
  /** Intended stay in whole months. */
  intendedStayMonths: number;
  maxMonthlyRent: number;
  maxInitialPayment: number;
  prefersShortCommute: boolean;
  /** Bumped on every confirmed change, for evaluation staleness checks. */
  revision: number;
}

/** The frozen input set a cumulative policy comparison was computed against. */
export interface ScenarioSnapshot {
  tenant: TenantProfile;
  listings: Listing[];
  /** ISO timestamp the inputs were frozen. */
  frozenAt: string;
  /** sha256 over the frozen inputs. */
  inputsHash: string;
}

/* -------------------------------------------------------------- evaluation */

export type FitStatus =
  /** Every check against the tenant's stated requirements passed. */
  | 'fits'
  /** At least one check failed on its merits. */
  | 'does-not-fit'
  /** A required input is missing — an unknown cost is never zero. */
  | 'needs-information'
  /** The engine could not produce a result (veto or technical failure). */
  | 'evaluation-unavailable';

export interface CheckResult {
  /** Lemma rule name, e.g. "fits_initial_payment_budget". */
  rule: string;
  label: string;
  /** null when the rule vetoed or was missing data. */
  passed: boolean | null;
  /** Human-readable value from the engine, e.g. "2450.00 eur". */
  display?: string;
  vetoReason?: string;
  missingData?: string[];
}

export interface CostBreakdown {
  monthlyRent: number | null;
  effectiveDeposit: number | null;
  bookingFee: number | null;
  initialPayment: number | null;
  effectiveMinimumStayMonths: number | null;
}

/**
 * One authoritative assessment of one listing.
 * Produced only by the harness, only from a real engine run.
 */
export interface Assessment {
  /** Unique id for this evaluation. */
  evaluationId: string;
  listingReference: string;
  status: FitStatus;
  checks: CheckResult[];
  costs: CostBreakdown;
  /** Rule names whose inputs were not bound. */
  missingInputs: string[];
  /** Plain-language explanation assembled from the engine result. */
  summary: string;
  /** Raw engine response, preserved unmodified. */
  raw: unknown;
  /** Engine explanation tree for the overall fit rule, when requested. */
  explanation?: unknown;

  /* provenance — every assessment is tied to all of these */
  tenantRevision: number;
  listingRevision: number;
  snapshotId: SnapshotId;
  sourceHash: string;
  /** ISO instant the evaluation ran. */
  evaluatedAt: string;
  /** Effective instant handed to the engine. */
  effective: string;
}

/** Results for every listing at one snapshot, against one frozen scenario. */
export interface SnapshotEvaluation {
  snapshotId: SnapshotId;
  sourceHash: string;
  inputsHash: string;
  assessments: Assessment[];
}

/* --------------------------------------------------------------- sessions */

export interface HarnessEvent {
  id: string;
  at: string;
  kind:
    | 'policy.activated'
    | 'policy.validated'
    | 'policy.imported'
    | 'policy.exported'
    | 'evaluation.ran'
    | 'scenario.changed'
    | 'profile.changed'
    | 'chat.message'
    | 'chat.tool'
    | 'application.created'
    | 'error';
  summary: string;
  detail?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
  /** Tool calls the assistant actually made for this turn. */
  toolCalls?: { name: string; input: unknown; output: unknown }[];
  /** Snapshot active when this message was produced. */
  snapshotId?: SnapshotId;
  /** True once a newer snapshot has been activated since. */
  outdated?: boolean;
}

export interface DemoApplication {
  id: string;
  listingReference: string;
  createdAt: string;
  /** The re-evaluation that was run immediately before creating it. */
  evaluationId: string;
  snapshotId: SnapshotId;
  sourceHash: string;
}

export interface SessionState {
  id: string;
  tenant: TenantProfile;
  listings: Listing[];
  activeSnapshotId: SnapshotId;
  /** Previous active snapshot, for one-step restore. */
  previousSnapshotId: SnapshotId | null;
  messages: ChatMessage[];
  events: HarnessEvent[];
  applications: DemoApplication[];
  /** Latest assessment per listing reference. */
  assessments: Record<string, Assessment>;
}

/* ---------------------------------------------------------- presenter bar */

export interface SystemStatus {
  ai: { configured: boolean; model: string | null; lastError: string | null };
  lemma: { runtime: string; version: string; loaded: boolean };
  activeSnapshot: { id: SnapshotId; label: string; sourceHash: string } | null;
  lemmabase: {
    repository: string;
    repositoryUrl: string;
    /**
     * "stored-snapshot" means the app is running from a captured bundle.
     * "connected" means it read the repository live during this session.
     */
    mode: 'stored-snapshot' | 'connected';
    lastSyncAt: string | null;
  };
  demoData: { listings: number; tenant: string };
  lastEvaluation: { evaluationId: string; at: string; snapshotId: SnapshotId } | null;
}

/* --------------------------------------------------------------- constants */

export const SPEC_NAME = 'shortlist_policy';
export const SPEC_PATH = 'shortlist_policy.lemma';
export const REPOSITORY = '@tristan-van-doorn/ha-shortlist-demo';
export const REPOSITORY_URL = 'https://lemmabase.com/@tristan-van-doorn/ha-shortlist-demo';

/** Lemma rule names, in presentation order. */
export const RULES = [
  'booking_fee',
  'effective_deposit',
  'initial_payment',
  'effective_minimum_stay',
  'fits_monthly_budget',
  'fits_initial_payment_budget',
  'meets_minimum_stay',
  'offer_fits',
] as const;

export const CHECK_LABELS: Record<string, string> = {
  fits_monthly_budget: 'Monthly rent within budget',
  fits_initial_payment_budget: 'Initial payment within budget',
  meets_minimum_stay: 'Stay length meets the minimum',
  offer_fits: 'Overall fit',
};
