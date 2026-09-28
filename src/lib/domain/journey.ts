import type { JourneyFacts } from '@/lib/contracts';

/**
 * The journey Alex is actually on. Fictional.
 *
 * Alex took Canal Studio (A) at €1,100 a month with a €2,200 deposit — the
 * shortlist's own winner, so the spine starts where the search left off.
 *
 * Each moment's facts are deliberately set to the interesting case rather than
 * the happy one: a contract with a charge the advert never mentioned, an offer
 * above the renewal cap, and a claim on the deposit with nothing to support it.
 * A presenter moves one fact and watches the answer move with it.
 */
export function seedJourney(): JourneyFacts {
  return {
    contract: {
      advertisedMonthlyRent: 1100,
      contractMonthlyRent: 1100,
      // Never mentioned in the listing. This is the whole moment.
      contractServiceCharge: 85,
      advertisedDeposit: 2200,
      contractDeposit: 2200,
      contractNoticePeriodMonths: 2,
    },
    renewal: {
      currentMonthlyRent: 1100,
      proposedMonthlyRent: 1250,
      contractType: 'liberalised',
      noticeGivenMonths: 3,
    },
    deposit: {
      depositHeld: 2200,
      rentArrears: 0,
      claimedAmount: 600,
      claimCategory: 'accidental_damage',
      // No move-in photograph to compare against, so nothing is chargeable yet.
      claimEvidenced: false,
    },
    revision: 1,
  };
}
