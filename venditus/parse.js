/* venditus/parse.js — raw workbook cells → a normalised dataset.
 *
 * Input is the flat shape produced by tools/xlsx-to-raw.py, and by SheetJS in
 * the browser: { sheets: { NAME: { cells: { A1: {v|f, r, z} } } } }.
 * Nothing here interprets business rules — that is model.js. This layer only
 * finds values, coerces types, and reports what it could not find.
 */
(function (global) {
  'use strict';

  /* ── coercion ─────────────────────────────────────────────────────────── */

  // The workbook stores several numbers as text. Accept both, and accept the
  // Norwegian decimal comma while we are at it.
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim().replace(/\s| /g, '').replace(',', '.');
    if (s === '' || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null;
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  function text(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function yesno(v) {
    var s = text(v).toUpperCase();
    if (s === 'JA' || s === 'YES' || s === 'TRUE') return true;
    if (s === 'NEI' || s === 'NO' || s === 'FALSE') return false;
    return null;
  }

  // Accepts "2025-01", "2025-01-15", a Date, or an Excel serial date.
  function month(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return iso(v).slice(0, 7);
    var s = text(v);
    var m = s.match(/^(\d{4})[-/](\d{1,2})/);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2);
    var n = num(v);
    if (n !== null && n > 20000 && n < 80000) return excelDate(n).slice(0, 7);
    return s;
  }

  function date(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return iso(v);
    var s = text(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var n = num(v);
    if (n !== null && n > 20000 && n < 80000) return excelDate(n);
    return s;
  }

  function iso(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function excelDate(serial) {
    return iso(new Date(Math.round((serial - 25569) * 86400000)));
  }

  var COERCE = { text: text, num: num, kr: num, rate: num, yesno: yesno, month: month, date: date };

  /* ── name and label matching ──────────────────────────────────────────── */

  // Sellers are joined across four sheets by name string alone — the workbook
  // has no ID and no validation. Fold whitespace and case so a stray double
  // space cannot silently zero someone's month.
  function nameKey(s) {
    return text(s).replace(/\s+/g, ' ').toLowerCase();
  }

  // Config labels are matched loosely so that rewording "AGA-sats — Oslo sone 1"
  // does not detach the value from the app.
  function labelKey(s) {
    return text(s)
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[—–-]/g, ' ')
      .replace(/[^\wæøåÆØÅ%\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ── sheet access ─────────────────────────────────────────────────────── */

  function Sheet(raw, name) {
    this.name = name;
    this.cells = (raw && raw.sheets && raw.sheets[name] && raw.sheets[name].cells) || null;
    this.missing = !this.cells;
  }

  Sheet.prototype.raw = function (ref) {
    var c = this.cells && this.cells[ref];
    if (!c) return null;
    return 'v' in c ? c.v : (c.f !== undefined ? { formula: c.f } : null);
  };

  Sheet.prototype.value = function (ref) {
    var v = this.raw(ref);
    return v && typeof v === 'object' && 'formula' in v ? null : v;
  };

  Sheet.prototype.role = function (ref) {
    var c = this.cells && this.cells[ref];
    return (c && c.r) || null;
  };

  /* ── parse ────────────────────────────────────────────────────────────── */

  function parse(raw, mapping) {
    mapping = mapping || global.VenditusMapping;
    var diagnostics = [];
    var note = function (level, area, message) {
      diagnostics.push({ level: level, area: area, message: message });
    };

    if (!raw || !raw.sheets) {
      note('error', 'file', 'No workbook data — nothing to read.');
      return { dataset: null, diagnostics: diagnostics };
    }

    // Every sheet the mapping expects must exist.
    var wanted = {};
    wanted[mapping.config.sheet] = 1;
    Object.keys(mapping.tables).forEach(function (k) { wanted[mapping.tables[k].sheet] = 1; });
    wanted[mapping.calc.sheet] = 1;
    Object.keys(wanted).forEach(function (name) {
      if (!raw.sheets[name]) note('error', 'sheet', 'Sheet "' + name + '" is not in this workbook.');
    });
    (raw.sheetNames || []).forEach(function (name) {
      if (!wanted[name]) note('info', 'sheet', 'Sheet "' + name + '" is present but not mapped — ignored.');
    });

    var config = parseConfig(raw, mapping, note);
    var tables = {};
    Object.keys(mapping.tables).forEach(function (key) {
      tables[key] = parseTable(raw, mapping.tables[key], key, note);
    });

    crossCheck(tables, note);

    var months = {};
    ['sales', 'hr', 'bonus'].forEach(function (k) {
      (tables[k] || []).forEach(function (r) { if (r.month) months[r.month] = 1; });
    });

    return {
      dataset: {
        source: raw.source || 'workbook',
        config: config,
        employees: tables.employees,
        sales: tables.sales,
        hr: tables.hr,
        bonus: tables.bonus,
        onboarding: tables.onboarding,
        navSubsidy: tables.navSubsidy,
        navSickRefund: tables.navSickRefund,
        agaQuarters: tables.agaQuarters,
        months: Object.keys(months).sort()
      },
      diagnostics: diagnostics
    };
  }

  function parseConfig(raw, mapping, note) {
    var def = mapping.config;
    var sheet = new Sheet(raw, def.sheet);
    var config = { packRates: {}, _roles: {}, _cells: {} };

    if (sheet.missing) {
      note('error', 'config', 'KONFIGURASJON missing — every rate falls back to a default.');
      return config;
    }

    // Index the label column once so config resolves by text, not position.
    var byLabel = {};
    for (var r = def.searchRows[0]; r <= def.searchRows[1]; r++) {
      var label = text(sheet.value(def.labelCol + r));
      if (label) byLabel[labelKey(label)] = r;
    }

    function lookup(name, spec, into, key) {
      var row = null;
      var lk = labelKey(spec.label);
      if (lk && byLabel[lk] !== undefined) {
        row = byLabel[lk];
      } else if (lk) {
        // Prefix match catches a reworded tail, e.g. a changed parenthetical.
        var hit = Object.keys(byLabel).filter(function (k) {
          return k.indexOf(lk) === 0 || lk.indexOf(k) === 0;
        });
        if (hit.length === 1) row = byLabel[hit[0]];
      }

      var ref = row !== null ? def.valueCol + row : spec.cell;
      if (!ref) {
        if (!spec.missing) note('warn', 'config', 'No cell for "' + spec.label + '".');
        into[key] = null;
        return;
      }
      if (row === null && spec.cell) {
        note('warn', 'config', 'Label "' + spec.label + '" not found — fell back to cell ' + spec.cell + '.');
      }

      var v = num(sheet.value(ref));
      if (v === null && !spec.computed) {
        note('warn', 'config', '"' + spec.label + '" (' + ref + ') is empty or not a number.');
      }
      into[key] = v;
      config._roles[key] = sheet.role(ref) || 'input';
      config._cells[key] = ref;
    }

    Object.keys(def.keys).forEach(function (k) { lookup(k, def.keys[k], config, k); });
    Object.keys(def.packRates).forEach(function (k) {
      var spec = def.packRates[k];
      if (spec.missing) {
        // The count column exists in PHONERO RAPPORT with no matching rate.
        config.packRates[k] = 0;
        note('warn', 'config',
          'No commission rate for "' + spec.label + '" — the sales report counts it but ' +
          'KONFIGURASJON has no rate. Treated as kr 0; set one in Inndata.');
        return;
      }
      lookup(k, spec, config.packRates, k);
      if (config.packRates[k] === null) config.packRates[k] = 0;
    });

    // Derived config the workbook computes with formulas we do not evaluate.
    if (config.employerFactor === null) {
      config.employerFactor = 1 + (config.agaRate || 0) + (config.holidayRate || 0) + (config.pensionRate || 0);
    }
    if (config.workdaysPerMonth === null) config.workdaysPerMonth = (config.workdaysPerYear || 260) / 12;
    if (config.maxSickBase === null) config.maxSickBase = (config.grunnbelop || 0) * 6;
    if (config.onbTotal === null) {
      config.onbTotal = ['onbAdvertising', 'onbFee', 'onbCourse', 'onbTraining', 'onbEquipment']
        .reduce(function (a, k) { return a + (config[k] || 0); }, 0);
    }

    // The workbook has no field for what share of the pack revenue a seller
    // keeps, which is why its revenue and commission collapse into one number.
    // Seed defaults per contract type so margin is computable, and flag it.
    config.sellerShare = { 'Ren provisjon': 0.65, 'Fast + Provisjon': 0.5, 'Fast': 0.35 };
    note('info', 'config',
      'The workbook has no seller-share field, so revenue and the seller\'s commission ' +
      'are the same number in it. Clario splits them using a share per contract type ' +
      '(65 / 50 / 35 %) — editable in Inndata, and needs Kian\'s confirmation.');

    return config;
  }

  function parseTable(raw, def, key, note) {
    var sheet = new Sheet(raw, def.sheet);
    var rows = [];
    if (sheet.missing) return rows;

    // A renamed column shifts every value silently, so verify the header text
    // still sits where the mapping says it does.
    Object.keys(def.cols).forEach(function (field) {
      var col = def.cols[field].col;
      var head = text(sheet.value(col + def.headerRow));
      if (!head) {
        note('warn', 'column', def.sheet + '!' + col + def.headerRow +
          ' has no header — "' + field + '" may be reading the wrong column.');
      }
    });

    for (var r = def.firstRow; r <= def.lastRow; r++) {
      var row = { _row: r, _sheet: def.sheet };
      var any = false;

      Object.keys(def.cols).forEach(function (field) {
        var spec = def.cols[field];
        var v = sheet.value(spec.col + r);
        var coerce = COERCE[spec.type] || text;
        var out = coerce(v);
        row[field] = out;
        if (out !== null && out !== '' && out !== false) any = true;
      });

      // Rows exist as empty templates all the way down; keep only real ones.
      if (!any) continue;
      if (def.key.some(function (k) { return !row[k]; })) {
        var present = def.key.filter(function (k) { return row[k]; }).length;
        if (present) {
          note('warn', 'row', def.sheet + ' row ' + r + ' has data but is missing ' +
            def.key.filter(function (k) { return !row[k]; }).join(' + ') + ' — skipped.');
        }
        continue;
      }
      if (row.seller) row._key = nameKey(row.seller);
      if (row.name) row._key = nameKey(row.name);
      rows.push(row);
    }

    return rows;
  }

  // The join is by name string across four sheets. Report every name that does
  // not line up rather than letting it evaluate to zero.
  function crossCheck(tables, note) {
    var known = {};
    (tables.employees || []).forEach(function (e) { known[e._key] = e.name; });

    [['sales', 'PHONERO RAPPORT'], ['hr', 'HR INPUT'], ['bonus', 'BONUS REGISTER'],
     ['navSubsidy', 'NAV INN & UT'], ['navSickRefund', 'NAV INN & UT']]
      .forEach(function (pair) {
        var seen = {};
        (tables[pair[0]] || []).forEach(function (r) {
          if (!r._key || r._key === 'team' || seen[r._key]) return;
          seen[r._key] = 1;
          if (!known[r._key]) {
            note('warn', 'name', '"' + r.seller + '" appears in ' + pair[1] +
              ' but not in SELGER PROFIL — their figures will not roll up.');
          }
        });
      });

    (tables.onboarding || []).forEach(function (o) {
      if (o._key && !known[o._key]) {
        note('warn', 'name', '"' + o.name + '" is in ONBOARDING TRACKER but not in SELGER PROFIL.');
      }
    });
  }

  global.VenditusParse = {
    parse: parse,
    nameKey: nameKey,
    labelKey: labelKey,
    num: num,
    month: month
  };
})(typeof window !== 'undefined' ? window : globalThis);
