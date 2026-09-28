/** S4 executes from its captured published source, on both sides of the boundary. */
import { initSync, Engine } from '@lemmabase/lemma-engine';
import { readFileSync } from 'node:fs';
initSync({ module: readFileSync('node_modules/@lemmabase/lemma-engine/lemma_bg.wasm') });
const e = new Engine();
await e.load({ 'shortlist_policy.lemma': readFileSync('policies/snapshots/S4/shortlist_policy.lemma', 'utf8') });
const tenant = { intended_stay: '5 month', maximum_monthly_rent: '1200 eur', maximum_initial_payment: '2500 eur' };
const listings = [
  { listing_reference: 'A', monthly_rent: '1100 eur', requested_deposit: '2200 eur', listing_minimum_stay: '3 month' },
  { listing_reference: 'B', monthly_rent: '1150 eur', requested_deposit: '1150 eur', listing_minimum_stay: '4 month' },
  { listing_reference: 'C', monthly_rent: '1050 eur', requested_deposit: '1050 eur', listing_minimum_stay: '6 month' },
];
for (const when of ['2026-09-28', '2026-12-31', '2027-01-01', '2027-06-01']) {
  const cells = listings.map((l) => {
    const r = e.run({ spec: 'shortlist_policy', effective: when, data: { ...l, ...tenant } });
    return `${l.listing_reference}=${r.results.initial_payment.display.replace('.00 eur', '')}/${r.results.offer_fits.display === 'true' ? 'fits' : 'no'}`;
  });
  const v = e.run({ spec: 'shortlist_policy', effective: when, data: { ...listings[0], ...tenant }, rules: ['booking_fee'] });
  console.log(`  ${when}  version ${v.spec_effective_from}  fee ${v.results.booking_fee.display.replace('.00 eur', '')}   ${cells.join('  ')}`);
}
