import { initSync, Engine } from '@lemmabase/lemma-engine';
import { readFileSync } from 'node:fs';
initSync({ module: readFileSync('node_modules/@lemmabase/lemma-engine/lemma_bg.wasm') });
const listings = [
  { listing_reference: 'A', monthly_rent: '1100 eur', requested_deposit: '2200 eur', listing_minimum_stay: '3 month' },
  { listing_reference: 'B', monthly_rent: '1150 eur', requested_deposit: '1150 eur', listing_minimum_stay: '4 month' },
  { listing_reference: 'C', monthly_rent: '1050 eur', requested_deposit: '1050 eur', listing_minimum_stay: '6 month' },
];
const tenant = { intended_stay: '5 month', maximum_monthly_rent: '1200 eur', maximum_initial_payment: '2500 eur' };
for (const id of ['S0','S1','S2','S3']) {
  const e = new Engine();
  const errs = await e.load({ 'shortlist_policy.lemma': readFileSync(`policies/snapshots/${id}/shortlist_policy.lemma`, 'utf8') });
  if (errs) { console.log(id, 'LOAD ERRORS', JSON.stringify(errs).slice(0,300)); continue; }
  console.log(id, listings.map(l => {
    const r = e.run({ spec: 'shortlist_policy', data: { ...l, ...tenant } });
    return `${l.listing_reference}=${r.results.initial_payment.display.replace('.00 eur','')}/${r.results.offer_fits.display}`;
  }).join(' '));
}
