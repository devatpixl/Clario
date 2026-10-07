/* venditus/forecast.js — where the next months are heading.
 *
 * Venditus asked for more forecast. The rule here is that a forecast must be
 * explainable to a CFO in one sentence, and must never disagree with the rest
 * of the dashboard. So it does not invent its own cost logic:
 *
 *   1. take each seller's average month over the last (up to) three months
 *      that hold figures — sales per pack, absence, lists, clawback;
 *   2. write those averages into the dataset as future months;
 *   3. run the SAME VenditusModel.compute() the dashboard already uses.
 *
 * Every cost in a forecast month is therefore produced by Kian's own rules
 * (commission share, employer tax, holiday pay, pension, absence, 6G cap).
 * Bonus is a recurring cost for a sales team, so each seller's (and TEAM's)
 * average monthly bonus over the basis is carried forward. True one-offs are
 * left out on purpose — new hires, guarantee pay, incentives, severance —
 * because nothing in the workbook says they repeat.
 *
 * The range: the best and the worst of the basis months, relative to their
 * average, scale the sales counts. Three months of history cannot support a
 * confidence interval, and the page says so instead of pretending.
 *
 * Pure: dataset + model in, numbers out. No DOM, no formatting.
 */
(function (global) {
  'use strict';

  var PACK_KEYS = ['p1gb', 'p5gb', 'p10gb', 'p15gb', 'fkStrom', 'fkMobil', 'tryg'];
  // Recurring per-month figures worth averaging. One-offs are deliberately absent.
  var SALE_AVG = PACK_KEYS.concat(['commission', 'rejected', 'pending', 'clawback']);
  var HR_AVG = ['selfCertDays', 'sickDays', 'leaveDays', 'listCost', 'clawback', 'navRefund'];

  function n(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function key(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function addMonths(m, k) {
    var p = m.split('-'), y = +p[0], mo = +p[1] - 1 + k;
    y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    return y + '-' + (mo < 9 ? '0' : '') + (mo + 1);
  }

  // The months that actually hold figures — an empty "+ Ny rad" month at the
  // end must not drag the average to zero.
  function filledMonths(model) {
    return (model.months || []).filter(function (m) {
      var t = model.byMonth[m] && model.byMonth[m].total;
      return t && (t.revenue || t.totalCostAll);
    });
  }

  function averageRows(rows, fields, months, seller) {
    var out = { seller: seller };
    fields.forEach(function (f) {
      var sum = rows.reduce(function (a, r) { return a + n(r[f]); }, 0);
      out[f] = sum / months;
    });
    return out;
  }

  /* dataset + model → forecast. opts: { horizon, basis } */
  function build(dataset, model, opts) {
    opts = opts || {};
    if (!dataset || !model || !global.VenditusModel) return null;
    var filled = filledMonths(model);
    if (!filled.length) return null;

    var basisN = Math.min(opts.basis || 3, filled.length);
    var basis = filled.slice(-basisN);
    var last = basis[basis.length - 1];
    var lastMonthNo = +last.split('-')[1];
    // Far enough to reach December, never shorter than three months.
    var horizon = Math.max(opts.horizon || 3, 12 - lastMonthNo);
    var future = [];
    for (var i = 1; i <= horizon; i++) future.push(addMonths(last, i));

    // Who sells next month: everyone active in SELGER PROFIL who appears in
    // the basis, plus anyone in the basis missing from the profile (their cost
    // is real either way).
    var inBasis = {};
    (dataset.sales || []).concat(dataset.hr || []).forEach(function (r) {
      if (basis.indexOf(r.month) >= 0 && r.seller && key(r.seller) !== 'team') inBasis[key(r.seller)] = r.seller;
    });
    var inactive = {};
    (dataset.employees || []).forEach(function (e) { if (e.active === false) inactive[key(e.name)] = 1; });
    var sellers = Object.keys(inBasis).filter(function (k) { return !inactive[k]; })
      .map(function (k) { return inBasis[k]; });

    var avgSale = {}, avgHr = {};
    sellers.forEach(function (s) {
      var k = key(s);
      var sales = (dataset.sales || []).filter(function (r) { return key(r.seller) === k && basis.indexOf(r.month) >= 0; });
      var hr = (dataset.hr || []).filter(function (r) { return key(r.seller) === k && basis.indexOf(r.month) >= 0; });
      avgSale[k] = averageRows(sales, SALE_AVG, basisN, s);
      avgHr[k] = averageRows(hr, HR_AVG, basisN, s);
    });

    // Average bonus per month, by person (TEAM included — it is a company cost).
    var avgBonus = {};
    (dataset.bonus || []).forEach(function (b) {
      if (basis.indexOf(b.month) < 0) return;
      var k = key(b.seller);
      if (inactive[k]) return;
      var a = avgBonus[k] || (avgBonus[k] = { seller: b.seller, taxed: 0, taxFree: 0 });
      if (b.taxFree === true) a.taxFree += n(b.amount) / basisN; else a.taxed += n(b.amount) / basisN;
    });

    // Spread of the basis: how far the best and worst month sat from average.
    var revs = basis.map(function (m) { return n(model.byMonth[m].total.revenue); });
    var mean = revs.reduce(function (a, b) { return a + b; }, 0) / revs.length;
    var lowF = 0.9, highF = 1.1;
    if (revs.length > 1 && mean > 0) {
      lowF = Math.min(0.97, Math.min.apply(null, revs) / mean);
      highF = Math.max(1.03, Math.max.apply(null, revs) / mean);
    }

    function scenario(factor) {
      var d = clone(dataset);
      future.forEach(function (m) {
        sellers.forEach(function (s) {
          var k = key(s), a = avgSale[k], h = avgHr[k];
          var sale = { seller: s, month: m, ref: 'PROGNOSE', _forecast: true };
          SALE_AVG.forEach(function (f) {
            sale[f] = (PACK_KEYS.indexOf(f) >= 0 || f === 'commission') ? a[f] * factor : a[f];
          });
          d.sales.push(sale);
          var hr = { seller: s, month: m, newHire: false, guaranteeUsed: false, _forecast: true };
          HR_AVG.forEach(function (f) { hr[f] = h[f]; });
          d.hr.push(hr);
        });
        Object.keys(avgBonus).forEach(function (k) {
          var b = avgBonus[k];
          // paid:true keeps a forecast bonus out of "unpaid bonus" in accruals
          if (b.taxed) d.bonus.push({ seller: b.seller, month: m, description: 'Prognose (snitt)', amount: b.taxed, taxFree: false, paid: true, _forecast: true });
          if (b.taxFree) d.bonus.push({ seller: b.seller, month: m, description: 'Prognose (snitt, skattefri)', amount: b.taxFree, taxFree: true, paid: true, _forecast: true });
        });
      });
      d.months = (d.months || []).concat(future.filter(function (m) { return (d.months || []).indexOf(m) < 0; })).sort();
      return global.VenditusModel.compute(d);
    }

    var base = scenario(1), low = scenario(lowF), high = scenario(highF);
    var pick = function (M, m) { return M && M.byMonth[m] ? M.byMonth[m].total : null; };

    var months = future.map(function (m) {
      var b = pick(base, m), lo = pick(low, m), hi = pick(high, m);
      return {
        month: m,
        revenue: n(b && b.revenue), revenueLow: n(lo && lo.revenue), revenueHigh: n(hi && hi.revenue),
        totalCostAll: n(b && b.totalCostAll),
        marginKr: n(b && b.marginKr), marginLow: n(lo && lo.marginKr), marginHigh: n(hi && hi.marginKr),
        marginPct: n(b && b.marginPct),
        salesCount: n(b && b.salesCount),
        commission: n(b && b.commission), employerCost: n(b && b.employerCost),
        gross: n(b && b.gross), aga: n(b && b.aga), holiday: n(b && b.holiday), pension: n(b && b.pension),
        absenceCost: n(b && b.selfCertCost) + n(b && b.employerSickCost) + n(b && b.leaveCost),
        navReceived: n(b && b.navReceived),
        bonus: n(b && b.bonusWithEmployer) + n(b && b.teamBonus),
        other: n(b && b.clawback) + n(b && b.listCost),
        flow: (function () {
          var f = base && base.accruals && base.accruals.flow.filter(function (x) { return x.month === m; })[0];
          return f ? { inn: f.inn, ut: f.ut, net: f.net } : { inn: 0, ut: 0, net: 0 };
        })(),
        flowLow: (function () {
          var f = low && low.accruals && low.accruals.flow.filter(function (x) { return x.month === m; })[0];
          return f ? f.net : 0;
        })(),
        flowHigh: (function () {
          var f = high && high.accruals && high.accruals.flow.filter(function (x) { return x.month === m; })[0];
          return f ? f.net : 0;
        })()
      };
    });

    // Per seller, next month — for the extra column on Selgere.
    var next = future[0], bySeller = {};
    if (base && base.byMonth[next]) base.byMonth[next].rows.forEach(function (r) {
      bySeller[key(r.seller)] = { revenue: r.revenue, marginKr: r.marginKr, marginPct: r.marginPct, salesCount: r.salesCount };
    });

    // Year end: what has happened this calendar year + the forecast to December.
    var year = last.slice(0, 4);
    var ytd = { revenue: 0, marginKr: 0, months: 0 };
    filled.forEach(function (m) {
      if (m.slice(0, 4) !== year) return;
      var t = model.byMonth[m].total; ytd.revenue += n(t.revenue); ytd.marginKr += n(t.marginKr); ytd.months++;
    });
    var rest = { revenue: 0, marginKr: 0, revenueLow: 0, revenueHigh: 0, months: 0 };
    months.forEach(function (x) {
      if (x.month.slice(0, 4) !== year) return;
      rest.revenue += x.revenue; rest.marginKr += x.marginKr;
      rest.revenueLow += x.revenueLow; rest.revenueHigh += x.revenueHigh; rest.months++;
    });

    return {
      basis: basis, basisN: basisN, last: last, future: future,
      lowFactor: lowF, highFactor: highF,
      bonusPerMonth: Object.keys(avgBonus).reduce(function (a, k) { return a + avgBonus[k].taxed + avgBonus[k].taxFree; }, 0),
      sellers: sellers,
      months: months,
      bySeller: bySeller,
      yearEnd: {
        year: year,
        actualRevenue: ytd.revenue, actualMargin: ytd.marginKr, actualMonths: ytd.months,
        forecastRevenue: rest.revenue, forecastMargin: rest.marginKr, forecastMonths: rest.months,
        revenue: ytd.revenue + rest.revenue,
        revenueLow: ytd.revenue + rest.revenueLow, revenueHigh: ytd.revenue + rest.revenueHigh,
        marginKr: ytd.marginKr + rest.marginKr
      },
      model: base
    };
  }

  /* ── the next three months of payments ──────────────────────────────────
     Employer tax (AGA) is reported and paid in two-month terms, due the 15th
     of the month after the term: Jan–Feb → 15 Mar, Mar–Apr → 15 May, and so
     on (Skatteetaten). Holiday pay accrues all year and is paid out in June.
     Unpaid bonuses are already owed. Everything is an estimate built from the
     same rows as the rest of the model. */
  var TERMS = [
    { months: ['01', '02'], due: '03' }, { months: ['03', '04'], due: '05' },
    { months: ['05', '06'], due: '07' }, { months: ['07', '08'], due: '09' },
    { months: ['09', '10'], due: '11' }, { months: ['11', '12'], due: '01' }
  ];

  function calendar(model, fc, dataset, count) {
    if (!model || !fc) return [];
    count = count || 3;
    var cfg = model.config || {};
    var grossOf = function (m) {
      if (model.byMonth[m]) return n(model.byMonth[m].total.gross);
      var f = fc.months.filter(function (x) { return x.month === m; })[0];
      return f ? f.gross : 0;
    };
    var isForecast = function (m) { return !model.byMonth[m]; };
    var unpaid = model.accruals ? model.accruals.unpaidBonus : { withEmployer: 0, lines: [] };
    var holidayAccrued = model.accruals ? model.accruals.holidayTotal : 0;

    return fc.months.slice(0, count).map(function (x, i) {
      var m = x.month, y = +m.slice(0, 4), mm = m.slice(5);
      var items = [];
      items.push({ kind: 'pay', sign: -1, amount: x.gross + x.pension,
        no: 'Lønn og pensjon til selgerne', en: 'Salaries and pension',
        whyNo: 'Provisjon og fastlønn for måneden, pluss 2 % pensjon. Feriepenger settes av, men betales først i juni.',
        whyEn: 'Commission and fixed salary for the month, plus 2 % pension. Holiday pay is set aside, paid out in June.' });

      TERMS.forEach(function (t) {
        if (t.due !== mm) return;
        var ty = t.due === '01' ? y - 1 : y;
        var ms = t.months.map(function (k) { return ty + '-' + k; });
        var gross = ms.reduce(function (a, k) { return a + grossOf(k); }, 0);
        var est = ms.some(isForecast);
        if (gross) items.push({ kind: 'aga', sign: -1, amount: gross * n(cfg.agaRate), estimate: est,
          due: '15.' + mm + '.' + y, months: ms,
          no: 'Arbeidsgiveravgift (AGA)', en: 'Employer tax (AGA)',
          whyNo: 'For ' + ms.map(function (k) { return k.slice(5); }).join('–') + '/' + String(ty).slice(2)
            + ' · forfaller 15.' + mm + ' · ' + (n(cfg.agaRate) * 100).toFixed(1).replace('.', ',') + ' % av brutto lønn',
          whyEn: 'For ' + ms.map(function (k) { return k.slice(5); }).join('–') + '/' + String(ty).slice(2)
            + ' · due 15.' + mm + ' · ' + (n(cfg.agaRate) * 100).toFixed(1) + ' % of gross pay' });
      });

      if (mm === '06' && holidayAccrued) items.push({ kind: 'holiday', sign: -1, amount: holidayAccrued,
        no: 'Feriepenger utbetales', en: 'Holiday pay paid out',
        whyNo: 'Det som er satt av gjennom året betales ut i juni.', whyEn: 'What was set aside over the year is paid in June.' });

      if (i === 0 && unpaid.withEmployer) items.push({ kind: 'bonus', sign: -1, amount: unpaid.withEmployer,
        no: 'Bonus som ikke er utbetalt', en: 'Bonus not yet paid',
        whyNo: unpaid.lines.length + ' linjer i BONUS REGISTER står som «Utbetalt = NEI». Dette skylder dere allerede.',
        whyEn: unpaid.lines.length + ' lines in BONUS REGISTER are marked unpaid. This is already owed.' });

      if (x.bonus) items.push({ kind: 'bonusAvg', sign: -1, amount: x.bonus,
        no: 'Bonus (snitt)', en: 'Bonus (average)',
        whyNo: 'Snittet av bonusene de siste månedene, med arbeidsgiverkostnad.',
        whyEn: 'Average of recent bonuses, including employer cost.' });

      if (x.other) items.push({ kind: 'other', sign: -1, amount: x.other,
        no: 'Lister og clawback', en: 'Lists and clawback',
        whyNo: 'Snittet av de siste månedene.', whyEn: 'Average of recent months.' });

      var inn = x.revenue + x.navReceived;
      var out = items.reduce(function (a, it) { return a + it.amount; }, 0);
      return { month: m, inn: inn, revenue: x.revenue, nav: x.navReceived, items: items, out: out, net: inn - out };
    });
  }

  global.VenditusForecast = { build: build, calendar: calendar, addMonths: addMonths };
})(typeof window !== 'undefined' ? window : globalThis);
