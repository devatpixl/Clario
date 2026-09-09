/* venditus/mapping.js — where the workbook's shape is declared.
 *
 * This is the ONLY file that knows a sheet name, a column letter or a config
 * label. If Venditus (or we) restructure the workbook, this is the file to
 * edit — parse.js, model.js and the UI all stay put.
 *
 * Config values resolve by LABEL TEXT first, cell address second. Inserting a
 * row in KONFIGURASJON therefore does not break anything; renaming a label
 * falls back to the address and raises a diagnostic.
 */
(function (global) {
  'use strict';

  var MAPPING = {
    version: 'venditus-v2',

    /* ── KONFIGURASJON: rates and assumptions ───────────────────────────── */
    config: {
      sheet: 'KONFIGURASJON',
      labelCol: 'A',
      valueCol: 'B',
      sourceCol: 'C',
      noteCol: 'D',
      searchRows: [4, 40],
      keys: {
        agaRate:            { label: 'AGA-sats — Oslo sone 1',            cell: 'B4',  kind: 'rate' },
        holidayRate:        { label: 'Feriepenger-sats',                  cell: 'B5',  kind: 'rate' },
        pensionRate:        { label: 'Pensjon minimum (OTP)',             cell: 'B6',  kind: 'rate' },
        employerFactor:     { label: 'Total arbeidsgiver-faktor',         cell: 'B7',  kind: 'rate', computed: true },

        grunnbelop:         { label: 'Grunnbeløp G per år',               cell: 'B10', kind: 'kr' },
        maxSickBase:        { label: 'Maks sykepenger-grunnlag (6G)',     cell: 'B11', kind: 'kr',  computed: true },
        employerSickDays:   { label: 'Arbeidsgiver-dager (karensdager)',  cell: 'B12', kind: 'num' },
        workdaysPerYear:    { label: 'Arbeidsdager per år',               cell: 'B13', kind: 'num' },
        workdaysPerMonth:   { label: 'Arbeidsdager per måned (snitt)',    cell: 'B14', kind: 'num', computed: true },
        navSickRate:        { label: 'NAV sykepenger-sats',               cell: 'B15', kind: 'rate' },

        onbAdvertising:     { label: 'Rekrutteringsannonsering',          cell: 'B17', kind: 'kr' },
        onbFee:             { label: 'Rekrutteringshonorar',              cell: 'B18', kind: 'kr' },
        onbCourse:          { label: 'Kursmateriell / opplæring',         cell: 'B19', kind: 'kr' },
        onbTraining:        { label: 'Produktopplæring (tid × sats)',     cell: 'B20', kind: 'kr' },
        onbEquipment:       { label: 'Utstyr / SIM / headset',            cell: 'B21', kind: 'kr' },
        onbTotal:           { label: 'SUM onboarding per ansatt',         cell: 'B22', kind: 'kr', computed: true },

        guaranteeSalary:    { label: 'Garantilønn — minimum månedlig',    cell: 'B24', kind: 'kr' },
        commissionThreshold:{ label: 'Provisjonstrekk-terskel',           cell: 'B25', kind: 'num' },
        deductionPeriod:    { label: 'Trekkperiode før avregning',        cell: 'B26', kind: 'num' },

        navSubsidyRate:     { label: 'NAV lønnstilskudd-sats',            cell: 'B34', kind: 'rate' }
      },

      /* Commission per sales pack. These keys line up with `sales.packs`
       * below — that pairing is what makes the per-pack computation possible.
       * NOTE: the workbook has a "Phonero 1GB" count column but no 1GB rate,
       * so `p1gb` is declared here with no cell and defaults to 0. parse.js
       * raises a diagnostic for it. */
      packRates: {
        p1gb:    { label: 'Phonero — 1GB',          cell: null,  missing: true },
        p5gb:    { label: 'Phonero — 5GB',          cell: 'B27' },
        p10gb:   { label: 'Phonero — 10GB',         cell: 'B28' },
        p15gb:   { label: 'Phonero — 15GB',         cell: 'B29' },
        fkStrom: { label: 'Fjordkraft — Strøm',     cell: 'B30' },
        fkMobil: { label: 'Fjordkraft — Mobil',     cell: 'B31' },
        tryg:    { label: 'TRYG',                   cell: 'B32' }
      }
    },

    /* ── Row-per-record sheets ───────────────────────────────────────────── */
    tables: {
      employees: {
        sheet: 'SELGER PROFIL', headerRow: 3, firstRow: 4, lastRow: 23,
        key: ['name'],
        cols: {
          name:     { col: 'A', type: 'text' },
          start:    { col: 'B', type: 'date' },
          contract: { col: 'C', type: 'text' },
          product:  { col: 'D', type: 'text' },
          active:   { col: 'E', type: 'yesno' },
          end:      { col: 'F', type: 'date' },
          note:     { col: 'G', type: 'text' }
        }
      },

      sales: {
        sheet: 'PHONERO RAPPORT', headerRow: 4, firstRow: 5, lastRow: 54,
        key: ['seller', 'month'],
        cols: {
          month:      { col: 'A', type: 'month' },
          ref:        { col: 'B', type: 'text' },
          seller:     { col: 'C', type: 'text' },
          p1gb:       { col: 'D', type: 'num', pack: true },
          p5gb:       { col: 'E', type: 'num', pack: true },
          p10gb:      { col: 'F', type: 'num', pack: true },
          p15gb:      { col: 'G', type: 'num', pack: true },
          fkStrom:    { col: 'H', type: 'num', pack: true },
          fkMobil:    { col: 'I', type: 'num', pack: true },
          tryg:       { col: 'J', type: 'num', pack: true },
          commission: { col: 'K', type: 'kr' },
          rejected:   { col: 'L', type: 'num' },
          pending:    { col: 'M', type: 'num' },
          clawback:   { col: 'N', type: 'kr' }
        }
      },

      hr: {
        sheet: 'HR INPUT', headerRow: 4, firstRow: 5, lastRow: 55,
        key: ['seller', 'month'],
        cols: {
          seller:        { col: 'A', type: 'text' },
          month:         { col: 'B', type: 'month' },
          selfCertDays:  { col: 'C', type: 'num' },
          sickDays:      { col: 'D', type: 'num' },
          navRefund:     { col: 'E', type: 'kr' },
          leaveDays:     { col: 'F', type: 'num' },
          clawback:      { col: 'G', type: 'kr' },
          listCost:      { col: 'H', type: 'kr' },
          newHire:       { col: 'I', type: 'yesno' },
          /* J and K are SUMIFS back into BONUS REGISTER — model.js recomputes
           * them from the bonus table rather than reading the formula. */
          guaranteeUsed: { col: 'L', type: 'yesno' },
          incentives:    { col: 'M', type: 'kr' },
          severance:     { col: 'N', type: 'kr' },
          lostEarnings:  { col: 'O', type: 'kr' }
        }
      },

      bonus: {
        sheet: 'BONUS REGISTER', headerRow: 4, firstRow: 5, lastRow: 58,
        key: ['seller', 'month', 'description'],
        cols: {
          seller:      { col: 'A', type: 'text' },
          month:       { col: 'B', type: 'month' },
          description: { col: 'C', type: 'text' },
          type:        { col: 'D', type: 'text' },
          basis:       { col: 'E', type: 'text' },
          amount:      { col: 'F', type: 'kr' },
          /* G is amount × employerFactor unless tax-free — recomputed. */
          taxFree:     { col: 'H', type: 'yesno' },
          paid:        { col: 'I', type: 'yesno' },
          note:        { col: 'J', type: 'text' }
        }
      },

      onboarding: {
        sheet: 'ONBOARDING TRACKER', headerRow: 4, firstRow: 5, lastRow: 24,
        key: ['name'],
        cols: {
          name:            { col: 'A', type: 'text' },
          start:           { col: 'B', type: 'date' },
          advertising:     { col: 'C', type: 'kr' },
          fee:             { col: 'D', type: 'kr' },
          course:          { col: 'E', type: 'kr' },
          training:        { col: 'F', type: 'kr' },
          equipment:       { col: 'G', type: 'kr' },
          /* H sum, J/K break-even, L lost earnings are all recomputed. */
          daysToFirstSale: { col: 'I', type: 'num' }
        }
      },

      navSubsidy: {
        sheet: 'NAV INN & UT', headerRow: 13, firstRow: 14, lastRow: 33,
        key: ['seller', 'month'],
        cols: {
          seller:   { col: 'A', type: 'text' },
          month:    { col: 'B', type: 'month' },
          gross:    { col: 'C', type: 'kr' },
          received: { col: 'F', type: 'kr' },
          until:    { col: 'H', type: 'date' }
        }
      },

      navSickRefund: {
        sheet: 'NAV INN & UT', headerRow: 39, firstRow: 40, lastRow: 59,
        key: ['seller', 'month'],
        cols: {
          seller:   { col: 'A', type: 'text' },
          month:    { col: 'B', type: 'month' },
          days:     { col: 'C', type: 'num' },
          dayRate:  { col: 'D', type: 'kr' },
          received: { col: 'F', type: 'kr' },
          applied:  { col: 'H', type: 'date' }
        }
      },

      agaQuarters: {
        sheet: 'NAV INN & UT', headerRow: 4, firstRow: 5, lastRow: 8,
        key: ['quarter'],
        cols: {
          quarter: { col: 'A', type: 'text' },
          period:  { col: 'B', type: 'text' },
          gross:   { col: 'C', type: 'kr' },
          due:     { col: 'F', type: 'text' },
          status:  { col: 'G', type: 'text' },
          note:    { col: 'H', type: 'text' }
        }
      }
    },

    /* The derived sheet. We do not read its formulas — model.js reimplements
     * all 34 columns — but the column letters are kept so any figure in the UI
     * can link back to the cell it corresponds to. */
    calc: {
      sheet: 'BEREGNING PER SELGER', headerRow: 4, firstRow: 5, lastRow: 55,
      cells: {
        seller: 'A', month: 'B', contract: 'C', fixedSalary: 'D', commission: 'E',
        gross: 'F', employerCost: 'G', aga: 'H', holiday: 'I', pension: 'J',
        selfCertDays: 'K', selfCertCost: 'L', sickDays: 'M', employerSickCost: 'N',
        leaveDays: 'O', leaveCost: 'P', navRefund: 'Q', netPayroll: 'R',
        clawback: 'S', listCost: 'T', onboarding: 'U', indirect: 'V',
        totalCost: 'W', revenue: 'X', marginKr: 'Y', marginPct: 'Z',
        absencePct: 'AA', bonus: 'AB', bonusWithEmployer: 'AC', guarantee: 'AD',
        incentives: 'AE', severance: 'AF', lostEarnings: 'AG', totalCostAll: 'AH'
      }
    },

    /* Cells holding the literal text "← Tripletex": values the workbook cannot
     * supply yet. model.js surfaces them as "awaiting Tripletex" rather than
     * letting them poison a sum. */
    placeholders: ['← Tripletex']
  };

  global.VenditusMapping = MAPPING;
})(typeof window !== 'undefined' ? window : globalThis);
