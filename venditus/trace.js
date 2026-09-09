/* venditus/trace.js — where every number on the dashboard comes from.
 *
 * A metric on a chart is useless if you cannot get to the cell behind it. This
 * maps each model field back to its sheet, column and (when a seller and month
 * are known) the exact row — so a tooltip can say "HR INPUT!D12" and clicking
 * it lands on that cell in Arbeidsbok.
 *
 * The address it returns is the same string the grid already puts in
 * data-vd-set / data-vd-cell, so finding the node is one querySelector.
 */
(function (global) {
  'use strict';

  // Arbeidsbok tab key → the workbook's own sheet name
  var SHEET_NAME = {
    konfig: 'KONFIGURASJON',
    profil: 'SELGER PROFIL',
    phonero: 'PHONERO RAPPORT',
    hr: 'HR INPUT',
    bonus: 'BONUS REGISTER',
    beregning: 'BEREGNING PER SELGER',
    nav: 'NAV INN & UT',
    onboarding: 'ONBOARDING TRACKER'
  };

  // Compact codes for the source chips — the full name goes in the tooltip
  var SHEET_CODE = {
    konfig: 'KONF', profil: 'PROFIL', phonero: 'PHONERO', hr: 'HR',
    bonus: 'BONUS', beregning: 'BEREGNING', nav: 'NAV', onboarding: 'ONB'
  };

  // Which Arbeidsbok tab edits which parsed table
  var SHEET_TABLE = {
    profil: 'employees', phonero: 'sales', hr: 'hr',
    bonus: 'bonus', onboarding: 'onboarding'
  };

  /* Every metric the dashboard can show, and its origin.
   *   sheet     — Arbeidsbok tab to open
   *   field     — the column on that sheet's table (editable input)
   *   packs     — true when the value comes from all seven pack-count columns
   *   config    — a KONFIGURASJON key rather than a per-row cell
   *   computed  — lives on BEREGNING; `from` names what actually drives it   */
  var TRACE = {
    // ── revenue and commission
    revenue:          { sheet: 'phonero', packs: true,  no: 'Antall salg × sats per pakke',       en: 'Sales count × rate per pack' },
    revenueReported:  { sheet: 'phonero', field: 'commission', no: 'Phoneros egen sum',           en: "Phonero's own total" },
    revenueVariance:  { sheet: 'phonero', field: 'commission', no: 'Rapportert minus beregnet',   en: 'Reported minus computed' },
    salesCount:       { sheet: 'phonero', packs: true,  no: 'Sum av pakkekolonnene',              en: 'Sum of the pack columns' },
    commission:       { sheet: 'konfig',  config: 'sellerShare', no: 'Inntekt × selgerandel',     en: 'Revenue × seller share' },

    // ── payroll and its statutory on-costs
    gross:            { sheet: 'beregning', computed: true, from: 'commission', no: 'Fastlønn + provisjon', en: 'Fixed salary + commission' },
    employerCost:     { sheet: 'konfig',  config: 'employerFactor', no: 'Brutto × arbeidsgiverfaktor', en: 'Gross × employer factor' },
    aga:              { sheet: 'konfig',  config: 'agaRate',      no: 'Brutto × AGA-sats',        en: 'Gross × employer tax rate' },
    holiday:          { sheet: 'konfig',  config: 'holidayRate',  no: 'Brutto × feriepengesats',  en: 'Gross × holiday pay rate' },
    pension:          { sheet: 'konfig',  config: 'pensionRate',  no: 'Brutto × pensjonssats',    en: 'Gross × pension rate' },

    // ── absence
    selfCertDays:     { sheet: 'hr', field: 'selfCertDays', no: 'Egenmeldingsdager',              en: 'Self-certified days' },
    sickDays:         { sheet: 'hr', field: 'sickDays',     no: 'Sykemeldingsdager',              en: 'Doctor-certified days' },
    leaveDays:        { sheet: 'hr', field: 'leaveDays',    no: 'Permisjonsdager',                en: 'Leave days' },
    navReceived:      { sheet: 'hr', field: 'navRefund',    no: 'NAV-refusjon mottatt',           en: 'NAV refund received' },
    selfCertCost:     { sheet: 'hr', field: 'selfCertDays', no: 'Dager × dagsats',                en: 'Days × day rate' },
    employerSickCost: { sheet: 'konfig', config: 'employerSickDays', no: 'Dag 1–16 dekkes av arbeidsgiver', en: 'Days 1–16 are the employer’s' },
    leaveCost:        { sheet: 'hr', field: 'leaveDays',    no: 'Dager × dagsats',                en: 'Days × day rate' },
    navExpected:      { sheet: 'konfig', config: 'navSickRate', no: 'Fra dag 17, begrenset til 6G', en: 'From day 17, capped at 6G' },
    navGap:           { sheet: 'hr', field: 'navRefund',    no: 'Mottatt minus forventet',        en: 'Received minus expected' },
    absencePct:       { sheet: 'hr', field: 'sickDays',     no: 'Fraværsdager / arbeidsdager',    en: 'Absence days / working days' },

    // ── the rest of the cost stack
    clawback:         { sheet: 'hr', field: 'clawback',     no: 'Reversert provisjon',            en: 'Reversed commission' },
    listCost:         { sheet: 'hr', field: 'listCost',     no: 'Lister per kampanje',            en: 'Lists per campaign' },
    incentives:       { sheet: 'hr', field: 'incentives',   no: 'Uformelle insentiver',           en: 'Informal incentives' },
    severance:        { sheet: 'hr', field: 'severance',    no: 'Sluttavtale',                    en: 'Severance' },
    lostEarnings:     { sheet: 'hr', field: 'lostEarnings', no: 'Tapt inntjening i opplæring',    en: 'Lost earnings during training' },
    onboarding:       { sheet: 'konfig', config: 'onbTotal', no: 'Utløses av «Ny ansatt = JA»',   en: 'Triggered by "new hire = YES"' },
    guarantee:        { sheet: 'konfig', config: 'guaranteeSalary', no: 'Gulv når provisjon er lav', en: 'Floor when commission is low' },
    bonus:            { sheet: 'bonus', field: 'amount',    no: 'Bonusbeløp',                     en: 'Bonus amount' },
    bonusWithEmployer:{ sheet: 'bonus', field: 'amount',    no: 'Bonus × arbeidsgiverfaktor',     en: 'Bonus × employer factor' },

    // ── the headline figures, all on the computed sheet
    totalCost:        { sheet: 'beregning', computed: true, no: 'Sum av kostnadspostene',         en: 'Sum of the cost items' },
    totalCostAll:     { sheet: 'beregning', computed: true, no: 'Total kostnad inkl. alle poster', en: 'Total cost, all items' },
    marginKr:         { sheet: 'beregning', computed: true, no: 'Inntekt minus total kostnad',    en: 'Revenue minus total cost' },
    marginPct:        { sheet: 'beregning', computed: true, no: 'Bidragsmargin i prosent',        en: 'Contribution margin, percent' },
    costPerSale:      { sheet: 'beregning', computed: true, no: 'Total kostnad / antall salg',    en: 'Total cost / sales count' },
    netPayroll:       { sheet: 'beregning', computed: true, no: 'AG-kostnad + fravær − NAV',      en: 'Employer cost + absence − NAV' }
  };

  // The pack-count columns, in workbook order
  var PACK_FIELDS = ['p1gb', 'p5gb', 'p10gb', 'p15gb', 'fkStrom', 'fkMobil', 'tryg'];

  function mapping() { return global.VenditusMapping; }

  function columnOf(sheetKey, field) {
    var table = SHEET_TABLE[sheetKey];
    var def = table && mapping().tables[table];
    var spec = def && def.cols[field];
    return spec ? spec.col : null;
  }

  function rowKeyFor(table, seller, month, description) {
    var n = String(seller || '').replace(/\s+/g, ' ').toLowerCase();
    if (!n) return null;
    if (table === 'onboarding' || table === 'employees') return n;
    if (!month) return null;
    if (table === 'bonus') return n + '|' + month + '|' + (description || '');
    return n + '|' + month;
  }

  // Find the parsed row so we can quote the workbook's real row number rather
  // than a position in a re-sorted table.
  function workbookRow(dataset, table, rowKey) {
    var rows = (dataset && dataset[table]) || [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var n = String(r.seller || r.name || '').replace(/\s+/g, ' ').toLowerCase();
      var k = (table === 'onboarding' || table === 'employees') ? n
            : (table === 'bonus') ? n + '|' + r.month + '|' + (r.description || '')
            : n + '|' + r.month;
      if (k === rowKey) return r._row || null;
    }
    return null;
  }

  /**
   * Resolve a metric into something clickable.
   *
   * @param {string} metric  a key of TRACE
   * @param {object} ctx     { seller, month, description, dataset, lang }
   * @returns {object|null}  { sheet, sheetName, target, ref, why }
   *   target — the address the grid puts on the cell, or null for a whole column
   *   ref    — what to show the user, e.g. "HR INPUT!D12"
   */
  function resolve(metric, ctx) {
    var spec = TRACE[metric];
    if (!spec) return null;
    ctx = ctx || {};
    var lang = ctx.lang === 'en' ? 'en' : 'no';
    var out = {
      metric: metric,
      sheet: spec.sheet,
      sheetName: SHEET_NAME[spec.sheet],
      why: spec[lang] || spec.no || '',
      target: null,
      ref: SHEET_NAME[spec.sheet],
      code: SHEET_CODE[spec.sheet],
      col: null
    };

    // A KONFIGURASJON rate: one cell, the same for everybody
    if (spec.config) {
      out.target = 'config.' + spec.config;
      var cells = (mapping().config.keys[spec.config] || {}).cell;
      out.ref = SHEET_NAME.konfig + (cells ? '!' + cells : '');
      if (spec.config === 'packRates') out.ref = SHEET_NAME.konfig + '!B27:B32';
      if (spec.config === 'sellerShare') out.ref = SHEET_NAME.konfig;
      out.col = 'B';
      return out;
    }

    // Derived on BEREGNING — addressable per row, never editable
    if (spec.computed) {
      var cCol = (mapping().calc.cells || {})[metric];
      out.target = ctx.seller && ctx.month
        ? 'beregning.' + rowKeyFor('calc', ctx.seller, ctx.month) + '.' + metric : null;
      out.ref = SHEET_NAME.beregning + (cCol ? '!' + cCol : '');
      out.col = cCol || null;
      return out;
    }

    var table = SHEET_TABLE[spec.sheet];

    // The seven pack columns together
    if (spec.packs) {
      var first = columnOf(spec.sheet, PACK_FIELDS[0]);
      var last = columnOf(spec.sheet, PACK_FIELDS[PACK_FIELDS.length - 1]);
      var key = rowKeyFor(table, ctx.seller, ctx.month);
      out.target = key ? table + '.' + key + '.' + PACK_FIELDS[1] : null;
      var row = key && ctx.dataset ? workbookRow(ctx.dataset, table, key) : null;
      out.ref = SHEET_NAME[spec.sheet] + '!' + first + (row || '') + ':' + last + (row || '');
      out.col = first;
      return out;
    }

    // A single input column, narrowed to one row when we know the seller
    var col = columnOf(spec.sheet, spec.field);
    var rowKey = rowKeyFor(table, ctx.seller, ctx.month, ctx.description);
    if (rowKey) {
      out.target = table + '.' + rowKey + '.' + spec.field;
      var wr = ctx.dataset ? workbookRow(ctx.dataset, table, rowKey) : null;
      out.ref = SHEET_NAME[spec.sheet] + '!' + col + (wr || '');
    } else {
      out.ref = SHEET_NAME[spec.sheet] + '!' + col;
    }
    out.col = col;
    return out;
  }

  // "HR INPUT!D12" → "HR!D12"; the full name stays in the title attribute.
  function short(t) {
    if (!t) return '';
    var bang = t.ref.indexOf('!');
    return bang < 0 ? t.code : t.code + t.ref.slice(bang);
  }

  // Pack a resolved target into the string the click handler reads back.
  function encode(t) {
    if (!t) return '';
    return [t.sheet, t.target || '', t.ref || '', t.col || ''].join('~');
  }

  function decode(v) {
    var p = String(v || '').split('~');
    return { sheet: p[0], target: p[1] || null, ref: p[2] || '', col: p[3] || null };
  }

  global.VenditusTrace = {
    TRACE: TRACE,
    SHEET_NAME: SHEET_NAME,
    SHEET_TABLE: SHEET_TABLE,
    PACK_FIELDS: PACK_FIELDS,
    resolve: resolve,
    short: short,
    SHEET_CODE: SHEET_CODE,
    encode: encode,
    decode: decode
  };
})(typeof window !== 'undefined' ? window : globalThis);
