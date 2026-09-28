/** The journey spine, executed from its captured published source. */
import { initSync, Engine } from '@lemmabase/lemma-engine';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

initSync({ module: readFileSync('node_modules/@lemmabase/lemma-engine/lemma_bg.wasm') });
const dir = join('policies', 'snapshots', 'S5');
const sources = Object.fromEntries(
  readdirSync(dir).filter((f) => f.endsWith('.lemma')).map((f) => [f, readFileSync(join(dir, f), 'utf8')]),
);
const e = new Engine();
await e.load(sources);

const show = (r, rule) => r.results[rule]?.display?.replace('.00 eur', '') ?? 'no answer';
const run = (spec, data, effective = null) => e.run({ spec, data, effective });

console.log('\ncontract_check — what the contract costs against what the advert said');
for (const [label, charge, notice] of [['as offered', '85 eur', '2 month'], ['charge removed', '0 eur', '2 month'], ['both fixed', '0 eur', '1 month']]) {
  const r = run('contract_check', {
    advertised_monthly_rent: '1100 eur', contract_monthly_rent: '1100 eur', contract_service_charge: charge,
    advertised_deposit: '2200 eur', contract_deposit: '2200 eur', contract_notice_period: notice,
  });
  console.log(`  ${label.padEnd(16)} monthly ${show(r, 'contract_monthly_cost').padEnd(6)} undisclosed ${show(r, 'undisclosed_monthly_cost').padEnd(4)} may be signed: ${show(r, 'contract_may_be_signed')}`);
}

console.log('\nrenewal_policy — the boundary an agent has to negotiate inside');
const renewal = { current_monthly_rent: '1100 eur', proposed_monthly_rent: '1250 eur', notice_given: '3 month' };
for (const when of ['2026-10-15', '2026-12-31', '2027-01-01', '2027-06-01']) {
  const r = run('renewal_policy', { ...renewal, contract_type: 'liberalised' }, when);
  console.log(`  ${when}  version ${r.spec_effective_from}  cap ${show(r, 'maximum_increase').padEnd(5)} max rent ${show(r, 'maximum_renewal_rent').padEnd(8)} offer of 1250 permitted: ${show(r, 'renewal_offer_permitted')}`);
}
for (const type of ['regulated', 'liberalised', 'student_housing']) {
  const r = run('renewal_policy', { ...renewal, contract_type: type }, '2026-10-15');
  console.log(`  ${type.padEnd(16)} cap ${show(r, 'maximum_increase').padEnd(5)} max rent ${show(r, 'maximum_renewal_rent')}`);
}

console.log('\ndeposit_settlement — a claim against 2200 eur held');
const deposit = { deposit_held: '2200 eur', rent_arrears: '0 eur', claimed_amount: '600 eur' };
for (const [category, evidenced] of [['accidental_damage', false], ['accidental_damage', true], ['normal_wear', true], ['redecoration', true]]) {
  const r = run('deposit_settlement', { ...deposit, claim_category: category, claim_evidenced: evidenced });
  console.log(`  ${category.padEnd(18)} evidence ${String(evidenced).padEnd(6)} withheld ${show(r, 'deduction_payable').padEnd(10)} returned ${show(r, 'refund_to_tenant')}`);
}
console.log();
