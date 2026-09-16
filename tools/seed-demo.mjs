/* tools/seed-demo.mjs — generate venditus/demo.js
 *
 * Kian's workbook is a template: real employees and real rates, but PHONERO
 * RAPPORT is empty and HR INPUT has a single example row. With nothing to
 * show, none of the micro views mean anything.
 *
 * So we generate transactional demo data — sales counts per pack, absence,
 * bonuses, onboarding — in exactly the shape parse.js produces. Config and
 * employees still come from the real file; only the transactions are invented,
 * and every view labels them as demo. The moment a workbook with real sales is
 * imported, this is replaced wholesale.
 *
 *   node tools/seed-demo.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Deterministic PRNG — the demo must not shuffle between reloads or reviewers.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Four months is enough for a trend, a falling-margin alert and a quarter of
// employer tax, without filling the sheet with rows nobody reads. Every seller
// gets one row per month, so this is sellers × months — 4 × 4 = 16.
const MONTHS = ['2025-03', '2025-04', '2025-05', '2025-06'];

// Shaped to each seller's contract and product, per SELGER PROFIL.
const PROFILES = [
  {
    name: 'Bilal Ahmad', seed: 11, product: 'Phonero',
    mix: { p1gb: [1, 4], p5gb: [8, 14], p10gb: [9, 16], p15gb: [5, 10], fkStrom: [2, 5], fkMobil: [1, 4], tryg: [0, 2] },
    absence: 0.25, listCost: [1200, 1800]
  },
  {
    name: 'Sharjeel X', seed: 23, product: 'Phonero',
    mix: { p1gb: [2, 5], p5gb: [7, 12], p10gb: [6, 12], p15gb: [3, 7], fkStrom: [1, 4], fkMobil: [1, 3], tryg: [0, 1] },
    absence: 0.45, listCost: [900, 1500]
  },
  {
    name: 'Danish Y', seed: 37, product: 'TRYG',
    mix: { p1gb: [0, 2], p5gb: [2, 5], p10gb: [2, 6], p15gb: [1, 3], fkStrom: [1, 3], fkMobil: [0, 2], tryg: [12, 20] },
    absence: 0.15, listCost: [600, 1100]
  },
  {
    name: 'Ansatt 4', seed: 53, product: 'Fjordkraft',
    mix: { p1gb: [0, 2], p5gb: [1, 4], p10gb: [1, 4], p15gb: [0, 2], fkStrom: [9, 16], fkMobil: [6, 12], tryg: [0, 1] },
    absence: 0.6, listCost: [700, 1200]
  }
];

// Kian's KONFIGURASJON rates, so the demo's reported commission lands close to
// what the pack rates imply — the variance is small and deliberate.
const RATES = { p1gb: 0, p5gb: 350, p10gb: 500, p15gb: 700, fkStrom: 400, fkMobil: 300, tryg: 500 };

// Sales volume per seller per month. At the pack rates in KONFIGURASJON
// (kr 300–700), a seller needs roughly 120–170 sales a month before the
// revenue can carry a Norwegian salary plus employer cost — so the mix ranges
// below are scaled to land there rather than at a token handful.
const VOLUME = 3.5;

const between = (r, [lo, hi]) => lo + Math.floor(r() * (hi - lo + 1));
const volume = (r, range) => Math.round(between(r, range) * VOLUME);

const sales = [];
const hr = [];
const bonus = [];
const onboarding = [];

PROFILES.forEach((p) => {
  const r = rng(p.seed);

  MONTHS.forEach((month, mi) => {
    // A gentle upward ramp so the trend charts have something to say.
    const lift = 1 + mi * 0.045;

    const packs = {};
    let computed = 0;
    Object.keys(p.mix).forEach((k) => {
      const c = Math.max(0, Math.round(volume(r, p.mix[k]) * lift));
      packs[k] = c;
      computed += c * RATES[k];
    });

    // Phonero's reported total drifts a few percent from what the pack rates
    // imply — that gap is the reconciliation the workbook cannot perform.
    const drift = 1 + (r() - 0.5) * 0.09;
    const reported = Math.round((computed * drift) / 10) * 10;

    sales.push({
      _row: sales.length + 5, _sheet: 'PHONERO RAPPORT',
      month, ref: 'PH-' + month.replace('-', '') + '-' + (p.seed + mi),
      seller: p.name, ...packs,
      commission: reported,
      rejected: between(r, [0, 3]),
      pending: between(r, [0, 5]),
      clawback: r() < 0.25 ? Math.round(between(r, [400, 2200]) / 50) * 50 : 0,
      _key: p.name.toLowerCase()
    });

    // Absence: mostly clean months, occasional self-certified days, rarer
    // doctor-certified spells long enough to cross the 16-day employer window.
    const roll = r();
    let selfCertDays = 0, sickDays = 0;
    if (roll < p.absence * 0.6) selfCertDays = between(r, [1, 3]);
    else if (roll < p.absence) sickDays = between(r, [4, 14]);

    // One long spell, planted deliberately: it is the only way to exercise the
    // day-17 NAV refund and the 6G cap, which are core to the client's ask.
    if (p.name === 'Sharjeel X' && month === '2025-03') { sickDays = 21; selfCertDays = 0; }

    const navDays = Math.max(sickDays - 16, 0);

    hr.push({
      _row: hr.length + 5, _sheet: 'HR INPUT',
      seller: p.name, month,
      selfCertDays, sickDays,
      // Deliberately short of the expected refund on one case so the
      // "expected vs received" gap has something to show.
      // NAV pays roughly kr 750 a day at these salaries; the planted case is
      // deliberately short so "expected vs received" has a gap to report.
      navRefund: navDays > 0 ? Math.round(navDays * (p.name === 'Sharjeel X' ? 540 : 750)) : 0,
      leaveDays: r() < 0.12 ? between(r, [1, 4]) : 0,
      clawback: 0,
      listCost: Math.round(between(r, p.listCost) / 50) * 50,
      newHire: false,
      guaranteeUsed: false,
      incentives: r() < 0.2 ? between(r, [500, 2500]) : 0,
      severance: 0,
      lostEarnings: 0,
      _key: p.name.toLowerCase()
    });
  });
});

// Ansatt 4 starts 2025-01-10 per SELGER PROFIL, so he carries the onboarding
// cost, the ramp-up and the guarantee-salary floor in his first months.
const NEW_HIRE = 'Ansatt 4';
hr.filter(h => h.seller === NEW_HIRE).forEach((h) => {
  if (h.month === '2025-01') { h.newHire = true; h.lostEarnings = 8200; }
  if (h.month === '2025-01' || h.month === '2025-02') h.guaranteeUsed = true;
});

onboarding.push({
  _row: 5, _sheet: 'ONBOARDING TRACKER',
  name: NEW_HIRE, start: '2025-01-10',
  advertising: 3000, fee: 0, course: 2000, training: 1500, equipment: 500,
  daysToFirstSale: 12, _key: NEW_HIRE.toLowerCase()
});

// Quarterly sales bonuses plus one tax-free Christmas gift, mirroring the
// four example rows already in BONUS REGISTER.
[
  ['Bilal Ahmad', '2025-03', 'Q1 salgsbonus', 'Salgsbonus', '128 salg', 15000, false, 'Over kvote'],
  ['Sharjeel X', '2025-03', 'Q1 salgsbonus', 'Salgsbonus', '96 salg', 10000, false, ''],
  ['Danish Y', '2025-03', 'Q1 TRYG-kampanje', 'Kampanjebonus', '54 poliser', 7500, false, ''],
  ['Bilal Ahmad', '2025-06', 'Q2 salgsbonus', 'Salgsbonus', '141 salg', 17500, false, 'Over kvote'],
  ['Ansatt 4', '2025-06', 'Q2 Fjordkraft-mål', 'Kampanjebonus', '78 avtaler', 6000, false, ''],
  ['Ansatt 4', '2025-04', 'Onboarding-mål nådd', 'Milepælsbonus', '30 salg', 2500, false, 'Første kvartal'],
  ['Sharjeel X', '2025-05', 'Gavekort', 'Gave', '', 1500, true, 'Skattefritt under 5 000']
].forEach((b, i) => {
  bonus.push({
    _row: i + 5, _sheet: 'BONUS REGISTER',
    seller: b[0], month: b[1], description: b[2], type: b[3], basis: b[4],
    amount: b[5], taxFree: b[6], paid: b[1] < '2025-06', note: b[7],
    _key: b[0].toLowerCase()
  });
});

const payload = { demo: true, months: MONTHS, newHire: NEW_HIRE, sales, hr, bonus, onboarding };

fs.writeFileSync(
  path.join(ROOT, 'venditus', 'demo.js'),
  '/* GENERATED by tools/seed-demo.mjs — do not edit by hand.\n' +
  '   Transactional demo data in the workbook\'s own shape. Employees and all\n' +
  '   rates still come from the real file; only these transactions are invented,\n' +
  '   because PHONERO RAPPORT ships empty. Regenerate: node tools/seed-demo.mjs */\n' +
  'window.VENDITUS_DEMO = ' + JSON.stringify(payload, null, 1) + ';\n',
  'utf8'
);

console.log(`venditus/demo.js — ${MONTHS.length} months, ${sales.length} sales rows, ` +
  `${hr.length} HR rows, ${bonus.length} bonus rows, ${onboarding.length} onboarding row`);
