/* venditus/model.js — the client's rules, in one pure place.
 *
 * Reimplements all 34 columns of BEREGNING PER SELGER, and corrects the six
 * defects found in the workbook. Every function here is pure: dataset in,
 * numbers out. No DOM, no state, no formatting.
 *
 * Where we deliberately differ from the workbook, the reason is marked FIX-n
 * and matches the numbering in the plan.
 */
(function (global) {
  'use strict';

  var PACKS = [
    { key: 'p1gb',    no: 'Phonero 1GB',       en: 'Phonero 1GB' },
    { key: 'p5gb',    no: 'Phonero 5GB',       en: 'Phonero 5GB' },
    { key: 'p10gb',   no: 'Phonero 10GB',      en: 'Phonero 10GB' },
    { key: 'p15gb',   no: 'Phonero 15GB',      en: 'Phonero 15GB' },
    { key: 'fkStrom', no: 'Fjordkraft Strøm',  en: 'Fjordkraft Power' },
    { key: 'fkMobil', no: 'Fjordkraft Mobil',  en: 'Fjordkraft Mobile' },
    { key: 'tryg',    no: 'TRYG',              en: 'TRYG' }
  ];

  function n(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function key(seller, month) { return String(seller).replace(/\s+/g, ' ').toLowerCase() + '|' + month; }

  /* ── indexes ──────────────────────────────────────────────────────────── */

  function index(dataset) {
    var ix = { sales: {}, hr: {}, bonus: {}, employees: {}, onboarding: {}, subsidy: {}, sickRefund: {} };

    (dataset.employees || []).forEach(function (e) { ix.employees[e._key] = e; });
    (dataset.onboarding || []).forEach(function (o) { ix.onboarding[o._key] = o; });
    (dataset.sales || []).forEach(function (s) { ix.sales[key(s.seller, s.month)] = s; });
    (dataset.hr || []).forEach(function (h) { ix.hr[key(h.seller, h.month)] = h; });
    (dataset.navSubsidy || []).forEach(function (s) { ix.subsidy[key(s.seller, s.month)] = s; });
    (dataset.navSickRefund || []).forEach(function (s) { ix.sickRefund[key(s.seller, s.month)] = s; });

    (dataset.bonus || []).forEach(function (b) {
      var k = key(b.seller, b.month);
      (ix.bonus[k] = ix.bonus[k] || []).push(b);
    });

    return ix;
  }

  /* ── per-pack commission — the control the workbook cannot produce ────── */

  // What share of the pack revenue each contract type pays out to the seller.
  // The workbook has no such field — it is the missing half of FIX-1, because
  // without it revenue and the seller's commission are the same number and the
  // margin can never be positive. Defaults below are assumptions for Kian to
  // confirm; all three are editable in Inndata.
  var DEFAULT_SHARE = { 'Ren provisjon': 0.65, 'Fast + Provisjon': 0.5, 'Fast': 0.35 };

  function shareFor(contract, config) {
    var table = (config && config.sellerShare) || DEFAULT_SHARE;
    var c = String(contract || '').trim();
    if (table[c] !== undefined && table[c] !== null) return table[c];
    var lc = c.toLowerCase();
    var hit = Object.keys(table).filter(function (k) { return k.toLowerCase() === lc; })[0];
    if (hit) return table[hit];
    return table['Fast + Provisjon'] !== undefined ? table['Fast + Provisjon'] : 0.5;
  }

  // FIX-4: the workbook records a count per pack and then never uses it, so the
  // only commission figure available is Phonero's own lump total. Computing
  // Σ(count × rate) gives an independent number to reconcile against.
  function commissionBreakdown(sale, config) {
    var rates = (config && config.packRates) || {};
    var lines = [];
    var computed = 0;
    var count = 0;

    PACKS.forEach(function (p) {
      var c = n(sale && sale[p.key]);
      var rate = n(rates[p.key]);
      var amount = c * rate;
      computed += amount;
      count += c;
      if (c || rate) {
        lines.push({ key: p.key, no: p.no, en: p.en, count: c, rate: rate, amount: amount, noRate: c > 0 && !rate });
      }
    });

    var reported = n(sale && sale.commission);
    return {
      lines: lines,
      count: count,
      computed: computed,
      reported: reported,
      variance: reported - computed,
      variancePct: computed ? (reported - computed) / computed : 0,
      hasReport: !!sale
    };
  }

  /* ── one seller, one month: the 34 columns ───────────────────────────── */

  function computeRow(seller, month, dataset, ix) {
    var config = dataset.config || {};
    var k = key(seller, month);
    var emp = ix.employees[String(seller).replace(/\s+/g, ' ').toLowerCase()] || null;
    var sale = ix.sales[k] || null;
    var hr = ix.hr[k] || null;
    var bonuses = ix.bonus[k] || [];

    var factor = n(config.employerFactor) || 1;
    var workdays = n(config.workdaysPerMonth) || 21.667;

    var comm = commissionBreakdown(sale, config);

    // FIX-1: the workbook reads revenue and the seller's commission from the
    // same cell, so margin can never be positive. Split them:
    //   revenue    = what Venditus earns, Σ(count × pack rate), reconciled
    //                against the lump total Phonero reports
    //   commission = the seller's share of that revenue, by contract type
    var contract = (emp && emp.contract) || 'Fast + Provisjon';
    var share = shareFor(contract, config);
    var revenue = comm.computed;
    var commission = revenue * share;

    // FIX-2: D and V hold the literal text "← Tripletex". The workbook's
    // IFERROR turns the whole cost sum into 0. We keep them as nulls, exclude
    // them from the total, and say so.
    var fixedSalary = hr && typeof hr.fixedSalary === 'number' ? hr.fixedSalary : null;
    var indirect = hr && typeof hr.indirect === 'number' ? hr.indirect : null;
    var awaiting = [];
    if (fixedSalary === null) awaiting.push('fixedSalary');
    if (indirect === null) awaiting.push('indirect');

    var gross = n(fixedSalary) + commission;
    var employerCost = gross * factor;
    var aga = gross * n(config.agaRate);
    var holiday = gross * n(config.holidayRate);
    var pension = gross * n(config.pensionRate);
    var dayRate = workdays ? gross / workdays : 0;

    var selfCertDays = n(hr && hr.selfCertDays);
    var sickDays = n(hr && hr.sickDays);
    var leaveDays = n(hr && hr.leaveDays);

    var selfCertCost = selfCertDays * dayRate;
    var employerSickDays = Math.min(sickDays, n(config.employerSickDays));
    var employerSickCost = employerSickDays * dayRate;
    var leaveCost = leaveDays * dayRate;

    // FIX-5: the workbook loads 6G into KONFIGURASJON and never references it,
    // so NAV refund is uncapped. Cap the basis at 6G as the rules require.
    var navDays = Math.max(sickDays - n(config.employerSickDays), 0);
    var annual = gross * 12;
    var cappedAnnual = config.maxSickBase ? Math.min(annual, n(config.maxSickBase)) : annual;
    var navDayBase = n(config.workdaysPerYear) ? cappedAnnual / n(config.workdaysPerYear) : 0;
    var navExpected = navDays * navDayBase * n(config.navSickRate);
    var navReceived = n(hr && hr.navRefund);
    var navCapped = annual > cappedAnnual && navDays > 0;

    var netPayroll = employerCost + selfCertCost + employerSickCost + leaveCost - navReceived;

    var clawback = n(hr && hr.clawback) || n(sale && sale.clawback);
    var listCost = n(hr && hr.listCost);
    var onboarding = (hr && hr.newHire === true) ? n(config.onbTotal) : 0;

    var totalCost = netPayroll + clawback + listCost + onboarding + n(indirect);

    var bonusTotal = 0;
    var bonusWithEmployer = 0;
    bonuses.forEach(function (b) {
      var amt = n(b.amount);
      bonusTotal += amt;
      bonusWithEmployer += b.taxFree === true ? amt : amt * factor;
    });

    // Guarantee tops the seller up to the floor when commission falls short.
    var guarantee = (hr && hr.guaranteeUsed === true)
      ? Math.max(n(config.guaranteeSalary) - commission, 0) : 0;

    var incentives = n(hr && hr.incentives);
    var severance = n(hr && hr.severance);
    var lostEarnings = n(hr && hr.lostEarnings);

    var totalCostAll = totalCost + bonusWithEmployer + guarantee + incentives + severance + lostEarnings;
    var marginKr = revenue - totalCostAll;

    return {
      seller: (emp && emp.name) || seller,
      month: month,
      contract: (emp && emp.contract) || '–',
      product: (emp && emp.product) || '–',
      active: emp ? emp.active !== false : true,
      inProfile: !!emp,

      fixedSalary: fixedSalary, indirect: indirect, awaiting: awaiting,

      commission: commission,
      sellerShare: share,
      revenueReported: comm.reported,
      revenueVariance: comm.variance,
      revenueVariancePct: comm.variancePct,
      // kept under the old names so existing call sites keep working
      commissionReported: comm.reported,
      commissionVariance: comm.variance,
      commissionVariancePct: comm.variancePct,
      packs: comm.lines,
      salesCount: comm.count,
      rejected: n(sale && sale.rejected),
      pending: n(sale && sale.pending),

      gross: gross, employerCost: employerCost, aga: aga, holiday: holiday, pension: pension,
      dayRate: dayRate,

      selfCertDays: selfCertDays, selfCertCost: selfCertCost,
      sickDays: sickDays, employerSickDays: employerSickDays, employerSickCost: employerSickCost,
      leaveDays: leaveDays, leaveCost: leaveCost,
      navDays: navDays, navExpected: navExpected, navReceived: navReceived,
      navGap: navReceived - navExpected, navCapped: navCapped,

      netPayroll: netPayroll,
      clawback: clawback, listCost: listCost, onboarding: onboarding,
      totalCost: totalCost,

      revenue: revenue, marginKr: marginKr,
      marginPct: revenue ? marginKr / revenue : 0,
      absencePct: workdays ? (selfCertDays + sickDays) / workdays : 0,

      bonus: bonusTotal, bonusWithEmployer: bonusWithEmployer, bonusLines: bonuses,
      guarantee: guarantee, incentives: incentives, severance: severance,
      lostEarnings: lostEarnings, totalCostAll: totalCostAll,

      costPerSale: comm.count ? totalCostAll / comm.count : 0,
      marginPerSale: comm.count ? marginKr / comm.count : 0,

      hasData: !!(sale || hr || bonuses.length)
    };
  }

  /* ── roll-ups ─────────────────────────────────────────────────────────── */

  var SUMMED = ['revenue', 'commission', 'revenueReported', 'revenueVariance',
    'commissionReported', 'commissionVariance', 'gross',
    'employerCost', 'aga', 'holiday', 'pension', 'selfCertCost', 'employerSickCost', 'leaveCost',
    'navExpected', 'navReceived', 'navGap', 'netPayroll', 'clawback', 'listCost', 'onboarding',
    'totalCost', 'marginKr', 'bonus', 'bonusWithEmployer', 'guarantee', 'incentives', 'severance',
    'lostEarnings', 'totalCostAll', 'salesCount', 'selfCertDays', 'sickDays', 'leaveDays', 'rejected', 'pending'];

  function total(rows, workdays) {
    var out = { count: rows.length };
    SUMMED.forEach(function (f) {
      out[f] = rows.reduce(function (a, r) { return a + n(r[f]); }, 0);
    });
    out.marginPct = out.revenue ? out.marginKr / out.revenue : 0;
    out.absencePct = rows.length && workdays
      ? (out.selfCertDays + out.sickDays) / (workdays * rows.length) : 0;
    out.costPerSale = out.salesCount ? out.totalCostAll / out.salesCount : 0;
    out.marginPerSale = out.salesCount ? out.marginKr / out.salesCount : 0;
    return out;
  }

  /* ── onboarding ───────────────────────────────────────────────────────── */

  // FIX-3: the workbook averages B26:B29, but B26 is "Trekkperiode før
  // avregning" — a count of months, not a rate. Average the pack rates only.
  function averagePackRate(config) {
    var rates = (config && config.packRates) || {};
    var vals = PACKS.map(function (p) { return n(rates[p.key]); }).filter(function (v) { return v > 0; });
    if (!vals.length) return 0;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }

  function computeOnboarding(dataset, dailyRevenue) {
    var config = dataset.config || {};
    var avg = averagePackRate(config);
    var workdays = n(config.workdaysPerMonth) || 21.667;
    // fall back to the pack-rate proxy only when there is no revenue history
    var perDay = n(dailyRevenue) || (avg / (workdays || 1));

    return (dataset.onboarding || []).map(function (o) {
      var sum = n(o.advertising) + n(o.fee) + n(o.course) + n(o.training) + n(o.equipment);
      var days = n(o.daysToFirstSale);
      return {
        name: o.name, start: o.start,
        advertising: n(o.advertising), fee: n(o.fee), course: n(o.course),
        training: n(o.training), equipment: n(o.equipment),
        sum: sum,
        daysToFirstSale: days,
        avgPackRate: avg,
        breakEvenCount: avg ? Math.ceil(sum / avg) : 0,
        breakEvenKr: sum,
        revenuePerDay: perDay,
        lostEarnings: days * perDay
      };
    });
  }

  /* ── accruals: what is owed, and when it falls due ───────────────────────
     Venditus has no bank data, so there is no cash balance to report. What the
     model *can* say honestly is what has been incurred and not yet paid:
     employer tax falls due quarterly, holiday pay accrues monthly against a
     once-a-year payout, and BONUS REGISTER carries its own paid/unpaid flag. */

  var QUARTERS = [
    { q: 1, key: 'Q1', no: 'Januar–Mars',      en: 'January–March',     due: '31.01', dueNo: '31. januar',  dueEn: '31 January' },
    { q: 2, key: 'Q2', no: 'April–Juni',       en: 'April–June',        due: '30.04', dueNo: '30. april',   dueEn: '30 April' },
    { q: 3, key: 'Q3', no: 'Juli–September',   en: 'July–September',    due: '31.07', dueNo: '31. juli',    dueEn: '31 July' },
    { q: 4, key: 'Q4', no: 'Oktober–Desember', en: 'October–December',  due: '31.10', dueNo: '31. oktober', dueEn: '31 October' }
  ];

  function accruals(model, dataset) {
    var config = model.config || {};
    var months = model.months;

    var aga = QUARTERS.map(function (q) {
      var ms = months.filter(function (m) { return Math.ceil((+m.split('-')[1]) / 3) === q.q; });
      var gross = ms.reduce(function (a, m) { return a + n(model.byMonth[m].total.gross); }, 0);
      return {
        key: q.key, no: q.no, en: q.en, dueNo: q.dueNo, dueEn: q.dueEn,
        months: ms, gross: gross,
        rate: n(config.agaRate),
        amount: gross * n(config.agaRate),
        active: ms.length > 0
      };
    });

    // Accrued monthly, paid out once a year — so the whole balance is a debt
    // sitting on the books until it is disbursed.
    var holiday = months.map(function (m) {
      return { month: m, amount: n(model.byMonth[m].total.holiday) };
    });
    var pension = months.map(function (m) {
      return { month: m, amount: n(model.byMonth[m].total.pension) };
    });

    var unpaid = { total: 0, withEmployer: 0, lines: [] };
    var factor = n(config.employerFactor) || 1;
    (dataset.bonus || []).forEach(function (b) {
      if (b.paid === true) return;
      var amt = n(b.amount);
      unpaid.total += amt;
      unpaid.withEmployer += b.taxFree === true ? amt : amt * factor;
      unpaid.lines.push(b);
    });

    // Negative gap = NAV has paid less than the rules say they owe.
    var nav = { expected: 0, received: 0, gap: 0, lines: [] };
    model.rows.forEach(function (r) {
      if (!r.navDays) return;
      nav.expected += r.navExpected;
      nav.received += r.navReceived;
      nav.gap += r.navGap;
      nav.lines.push(r);
    });

    // Money in and out per month, on an accrual basis. No opening balance and
    // no running total: the workbook cannot support either.
    var flow = months.map(function (m) {
      var t = model.byMonth[m].total;
      var inn = n(t.revenue) + n(t.navReceived);
      var ut = n(t.employerCost) + n(t.selfCertCost) + n(t.employerSickCost) + n(t.leaveCost)
             + n(t.clawback) + n(t.listCost) + n(t.onboarding) + n(t.bonusWithEmployer)
             + n(t.guarantee) + n(t.incentives) + n(t.severance) + n(t.lostEarnings) + n(t.teamBonus);
      return { month: m, inn: inn, ut: ut, net: inn - ut };
    });

    return {
      aga: aga,
      agaTotal: aga.reduce(function (a, q) { return a + q.amount; }, 0),
      holiday: holiday,
      holidayTotal: holiday.reduce(function (a, h) { return a + h.amount; }, 0),
      pension: pension,
      pensionTotal: pension.reduce(function (a, h) { return a + h.amount; }, 0),
      unpaidBonus: unpaid,
      nav: nav,
      flow: flow,
      owedTotal: aga.reduce(function (a, q) { return a + q.amount; }, 0)
        + holiday.reduce(function (a, h) { return a + h.amount; }, 0)
        + pension.reduce(function (a, h) { return a + h.amount; }, 0)
        + unpaid.withEmployer
    };
  }

  /* ── cost cascade: revenue down to margin, in the order it is incurred ─── */
  function cascade(total, lang) {
    var L = function (no, en) { return lang === 'en' ? en : no; };
    return [
      { key: 'revenue',           label: L('Inntekt', 'Revenue'),                 v: n(total.revenue),           sign: 1, metric: 'revenue' },
      { key: 'commission',        label: L('Provisjon', 'Commission'),            v: -n(total.commission),       sign: -1, metric: 'commission' },
      { key: 'aga',               label: L('Arbeidsgiveravgift', 'Employer tax'), v: -n(total.aga),              sign: -1, metric: 'aga' },
      { key: 'holiday',           label: L('Feriepenger', 'Holiday pay'),         v: -n(total.holiday),          sign: -1, metric: 'holiday' },
      { key: 'pension',           label: L('Pensjon', 'Pension'),                 v: -n(total.pension),          sign: -1, metric: 'pension' },
      { key: 'absence',           label: L('Fravær', 'Absence'),                  v: -(n(total.selfCertCost) + n(total.employerSickCost) + n(total.leaveCost)), sign: -1, metric: 'absencePct' },
      { key: 'navReceived',       label: L('NAV-refusjon', 'NAV refund'),         v: n(total.navReceived),       sign: 1, metric: 'navReceived' },
      { key: 'bonusWithEmployer', label: L('Bonus', 'Bonus'),                     v: -n(total.bonusWithEmployer), sign: -1, metric: 'bonusWithEmployer' },
      { key: 'other',             label: L('Øvrige kostnader', 'Other costs'),    v: -(n(total.clawback) + n(total.listCost) + n(total.onboarding) + n(total.guarantee) + n(total.incentives) + n(total.severance) + n(total.lostEarnings) + n(total.teamBonus)), sign: -1, metric: 'listCost' }
    ];
  }

  /* ── the whole model ──────────────────────────────────────────────────── */

  function compute(dataset) {
    if (!dataset) return null;
    var ix = index(dataset);
    var config = dataset.config || {};
    var workdays = n(config.workdaysPerMonth) || 21.667;

    var months = (dataset.months || []).slice().sort();
    var sellers = (dataset.employees || []).map(function (e) { return e.name; });

    // Anyone who appears in the data but not the profile still gets a row, so
    // their cost is never quietly dropped. "TEAM" is the workbook's pseudo-name
    // for a shared bonus and belongs to the company, not to a person.
    var extra = {};
    (dataset.sales || []).concat(dataset.hr || []).forEach(function (r) {
      var k = String(r.seller).replace(/\s+/g, ' ').toLowerCase();
      if (r.seller && k !== 'team' && !ix.employees[k] && !extra[k]) { extra[k] = 1; sellers.push(r.seller); }
    });

    var factor = n(config.employerFactor) || 1;
    var teamBonus = { total: 0, withEmployer: 0, lines: [], byMonth: {} };
    (dataset.bonus || []).forEach(function (b) {
      if (String(b.seller).trim().toLowerCase() !== 'team') return;
      var amt = n(b.amount);
      var withEmp = b.taxFree === true ? amt : amt * factor;
      teamBonus.total += amt;
      teamBonus.withEmployer += withEmp;
      teamBonus.lines.push(b);
      teamBonus.byMonth[b.month] = (teamBonus.byMonth[b.month] || 0) + withEmp;
    });

    var rows = [];
    months.forEach(function (m) {
      sellers.forEach(function (s) {
        var row = computeRow(s, m, dataset, ix);
        if (row.hasData) rows.push(row);
      });
    });

    var byMonth = {};
    months.forEach(function (m) {
      var mr = rows.filter(function (r) { return r.month === m; });
      var t = total(mr, workdays);
      // Team bonus is a real company cost, so it lands in the monthly total
      // even though no single seller carries it.
      t.teamBonus = n(teamBonus.byMonth[m]);
      t.totalCostAll += t.teamBonus;
      t.marginKr = t.revenue - t.totalCostAll;
      t.marginPct = t.revenue ? t.marginKr / t.revenue : 0;
      byMonth[m] = { month: m, rows: mr, total: t };
    });

    var bySeller = {};
    sellers.forEach(function (s) {
      var sr = rows.filter(function (r) { return r.seller === s; });
      if (sr.length) bySeller[s] = { seller: s, rows: sr, total: total(sr, workdays) };
    });

    var grand = total(rows, workdays);
    grand.teamBonus = teamBonus.withEmployer;
    grand.totalCostAll += teamBonus.withEmployer;
    grand.marginKr = grand.revenue - grand.totalCostAll;
    grand.marginPct = grand.revenue ? grand.marginKr / grand.revenue : 0;

    var out = {
      config: config,
      months: months,
      sellers: sellers,
      rows: rows,
      byMonth: byMonth,
      bySeller: bySeller,
      teamBonus: teamBonus,
      total: grand,
      onboarding: computeOnboarding(dataset, (function () {
        var active = rows.filter(function (r) { return r.revenue > 0; });
        if (!active.length) return 0;
        var avgMonthly = active.reduce(function (a, r) { return a + r.revenue; }, 0) / active.length;
        return avgMonthly / workdays;
      })()),
      packs: PACKS,
      avgPackRate: averagePackRate(config),
      employees: dataset.employees || [],
      source: dataset.source
    };

    out.accruals = accruals(out, dataset);
    return out;
  }

  /* ── rules — thresholds that flip a verdict, per Insight.dc.html ──────── */

  function rules(model, month, thresholds) {
    var t = thresholds || {};
    var m = model.byMonth[month];
    if (!m) return [];
    var tot = m.total;

    var absence = t.absence !== undefined ? t.absence : 6;
    var margin = t.margin !== undefined ? t.margin : 20;
    var variance = t.variance !== undefined ? t.variance : 5;

    var worst = m.rows.slice().sort(function (a, b) { return b.absencePct - a.absencePct; })[0];
    var thin = m.rows.filter(function (r) { return r.revenue > 0 && r.marginPct * 100 < margin; });
    var varPct = Math.abs(tot.revenueReported ? tot.revenueVariance / tot.revenueReported * 100 : 0);

    return [
      {
        id: 'absence', ref: 'AA', threshold: absence, unit: '%',
        value: tot.absencePct * 100, fires: tot.absencePct * 100 > absence,
        no: 'Sykefravær over terskel', en: 'Absence above threshold',
        detailNo: worst ? worst.seller + ' har høyest fravær' : '', detailEn: worst ? worst.seller + ' has the highest absence' : ''
      },
      {
        id: 'margin', ref: 'Z', threshold: margin, unit: '%',
        value: tot.marginPct * 100, fires: tot.marginPct * 100 < margin,
        no: 'Bidragsmargin under terskel', en: 'Contribution margin below threshold',
        detailNo: thin.length + ' selgere under ' + margin + ' %', detailEn: thin.length + ' sellers below ' + margin + ' %'
      },
      {
        id: 'variance', ref: 'E', threshold: variance, unit: '%',
        value: varPct, fires: varPct > variance,
        no: 'Inntektsavvik mot Phonero', en: 'Revenue variance vs Phonero',
        detailNo: 'Phonero rapporterer mot vår beregning fra pakkerater',
        detailEn: 'Phonero reported vs our computation from pack rates'
      },
      {
        id: 'guarantee', ref: 'AD', threshold: 0, unit: 'kr',
        value: tot.guarantee, fires: tot.guarantee > 0,
        no: 'Garantilønn utløst', en: 'Guaranteed salary triggered',
        detailNo: 'Provisjon under gulvet på kr ' + Math.round(n(model.config.guaranteeSalary)),
        detailEn: 'Commission below the kr ' + Math.round(n(model.config.guaranteeSalary)) + ' floor'
      }
    ];
  }

  global.VenditusModel = {
    compute: compute,
    computeRow: computeRow,
    commissionBreakdown: commissionBreakdown,
    averagePackRate: averagePackRate,
    accruals: accruals,
    cascade: cascade,
    QUARTERS: QUARTERS,
    shareFor: shareFor,
    DEFAULT_SHARE: DEFAULT_SHARE,
    rules: rules,
    index: index,
    total: total,
    PACKS: PACKS
  };
})(typeof window !== 'undefined' ? window : globalThis);
