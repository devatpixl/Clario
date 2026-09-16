/* venditus/store.js — the live layer.
 *
 * Holds one dataset, applies an overlay of user edits, recomputes the model on
 * every change and notifies listeners. This is the whole mechanism behind
 * "change a number and the dashboard moves": there is exactly one dataset, and
 * nothing downstream is allowed to cache its own copy.
 *
 * Edit addressing:
 *   config.agaRate                     a rate in KONFIGURASJON
 *   config.packRates.p10gb             a commission rate per pack
 *   sales.bilal ahmad|2025-03.p10gb    a cell on a transactional row
 *   hr.ida nordby|2025-04.sickDays
 */
(function (global) {
  'use strict';

  var LS_EDITS = 'clario.venditus.edits.v1';
  var LS_SOURCE = 'clario.venditus.source.v1';

  var ROW_KEY = {
    sales: function (r) { return r._key + '|' + r.month; },
    hr: function (r) { return r._key + '|' + r.month; },
    bonus: function (r) { return r._key + '|' + r.month + '|' + (r.description || r._row); },
    onboarding: function (r) { return r._key; },
    employees: function (r) { return r._key; }
  };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function Store() {
    this.base = null;         // dataset straight from the workbook
    this.dataset = null;      // base + demo + edits
    this.model = null;
    this.edits = {};
    this.diagnostics = [];
    this.usingDemo = false;
    this.listeners = [];
    this.sourceName = '';
  }

  Store.prototype.subscribe = function (fn) {
    this.listeners.push(fn);
    return function () {
      var i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    }.bind(this);
  };

  Store.prototype.emit = function () {
    this.listeners.forEach(function (fn) { try { fn(this); } catch (e) { /* a bad listener must not stop the rest */ } }.bind(this));
  };

  /* ── loading ──────────────────────────────────────────────────────────── */

  Store.prototype.init = function (raw, demo) {
    this.loadWorkbook(raw || global.VENDITUS_RAW, demo || global.VENDITUS_DEMO, true);
    return this;
  };

  Store.prototype.loadWorkbook = function (raw, demo, restoreEdits) {
    var parsed = global.VenditusParse.parse(raw, global.VenditusMapping);
    this.base = parsed.dataset;
    this.diagnostics = parsed.diagnostics.slice();
    this.sourceName = (this.base && this.base.source) || 'workbook';
    this.demo = demo || null;

    // The shipped workbook has an empty PHONERO RAPPORT, so without demo rows
    // there is nothing to render. Fall back only when there is genuinely no
    // sales data — a real import takes over immediately.
    this.usingDemo = !!(this.demo && (!this.base || !this.base.sales || !this.base.sales.length));
    if (this.usingDemo) {
      this.diagnostics.push({
        level: 'info', area: 'demo',
        message: 'PHONERO RAPPORT has no sales rows, so demo transactions are shown. ' +
                 'Rates and employees still come from ' + this.sourceName + '.'
      });
    }

    this.edits = restoreEdits ? this.readEdits() : {};
    try {
      this.recompute();
    } catch (e) {
      // A stored overlay that no longer computes is not worth a broken page.
      if (global.console && console.warn) {
        console.warn('[venditus] stored edits could not be applied — starting clean', e);
      }
      this.edits = {};
      this.persist();
      this.recompute();
      this.diagnostics.push({ level: 'warn', area: 'edits',
        message: 'Lagrede endringer kunne ikke leses og ble forkastet.' });
    }
    return this;
  };

  /* An edit overlay outlives the code that wrote it. A key from an older
     build, or a hand-made one, must not be able to poison the dataset and take
     the whole page down — so every restored key is checked against the grammar
     and anything unrecognised is dropped rather than applied. */
  Store.prototype.validEditPath = function (path) {
    if (typeof path !== 'string' || !path) return false;
    var parts = path.split('.');
    if (parts[0] === 'config') return parts.length >= 2 && !!parts[1];
    if (parts[0] === '_hidden') return parts.length >= 3 && !!ROW_KEY[parts[1]];
    if (!ROW_KEY[parts[0]]) return false;
    // table.rowKey.field — the row key may contain dots, the field may not be empty
    return parts.length >= 3 && !!parts[parts.length - 1];
  };

  Store.prototype.readEdits = function () {
    try {
      // ?reset=1 clears the overlay before anything reads it, so a bad edit can
      // always be escaped from the URL bar without opening devtools.
      var q = (global.location && global.location.search) || '';
      if (/[?&]reset=1\b/.test(q) || (global.location && global.location.hash === '#reset')) {
        global.localStorage.removeItem(LS_EDITS);
        global.localStorage.removeItem(LS_SOURCE);
        return {};
      }
      var stored = global.localStorage && global.localStorage.getItem(LS_EDITS);
      var src = global.localStorage && global.localStorage.getItem(LS_SOURCE);
      // Edits belong to the workbook they were made against.
      if (src && src !== this.sourceName) return {};
      var raw = stored ? JSON.parse(stored) : {};
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

      var out = {}, dropped = 0, self = this;
      Object.keys(raw).forEach(function (k) {
        var v = raw[k];
        var ok = self.validEditPath(k) &&
          (v === null || ['string', 'number', 'boolean'].indexOf(typeof v) >= 0);
        if (ok) out[k] = v; else dropped++;
      });
      if (dropped) {
        this.droppedEdits = dropped;
        if (global.console && console.warn) {
          console.warn('[venditus] dropped ' + dropped + ' unreadable edit(s) from storage');
        }
      }
      return out;
    } catch (e) { return {}; }
  };

  Store.prototype.persist = function () {
    try {
      if (!global.localStorage) return;
      global.localStorage.setItem(LS_EDITS, JSON.stringify(this.edits));
      global.localStorage.setItem(LS_SOURCE, this.sourceName);
    } catch (e) { /* private window, quota — the app still works in memory */ }
  };

  /* ── the merge: base + demo + edits ───────────────────────────────────── */

  Store.prototype.build = function () {
    var d = clone(this.base || { config: {}, employees: [], months: [] });

    if (this.usingDemo && this.demo) {
      d.sales = clone(this.demo.sales);
      d.hr = clone(this.demo.hr);
      d.bonus = clone(this.demo.bonus);
      d.onboarding = clone(this.demo.onboarding);
      d.months = this.demo.months.slice();
      d.demo = true;

    }

    d.sales = d.sales || []; d.hr = d.hr || []; d.bonus = d.bonus || [];
    d.onboarding = d.onboarding || [];

    // The workbook as it stood before anyone typed, kept so a changed cell can
    // say what it used to hold and offer to put it back.
    this.pristine = clone(d);

    this.applyEdits(d);
    return d;
  };

  /* The value a path held before the user's own edits. */
  Store.prototype.originalValue = function (path) {
    if (!this.pristine) return undefined;
    var parts = path.split('.');
    if (parts[0] === 'config') {
      var c = this.pristine.config || {};
      if (parts[1] === 'packRates') return (c.packRates || {})[parts[2]];
      if (parts[1] === 'sellerShare') return (c.sellerShare || {})[parts.slice(2).join('.')];
      if (parts[1] === '_label' || parts[1] === '_source') return (c[parts[1]] || {})[parts.slice(2).join('.')];
      return c[parts[1]];
    }
    var rows = this.pristine[parts[0]] || [];
    var keyOf = ROW_KEY[parts[0]];
    if (!keyOf) return undefined;
    var rowKey = parts.slice(1, -1).join('.');
    var field = parts[parts.length - 1];
    for (var i = 0; i < rows.length; i++) {
      if (keyOf(rows[i]) === rowKey) return rows[i][field];
    }
    return undefined;
  };

  Store.prototype.applyEdits = function (d) {
    var self = this;
    Object.keys(this.edits).forEach(function (path) {
      var value = self.edits[path];
      var parts = path.split('.');

      if (parts[0] === 'config') {
        if (parts[1] === 'packRates') {
          d.config.packRates = d.config.packRates || {};
          d.config.packRates[parts[2]] = value;
        } else if (parts[1] === 'sellerShare') {
          d.config.sellerShare = d.config.sellerShare || {};
          d.config.sellerShare[parts.slice(2).join('.')] = value;
        } else if (parts[1] === '_label' || parts[1] === '_source') {
          // the sheet's own text, editable like any other cell
          d.config[parts[1]] = d.config[parts[1]] || {};
          d.config[parts[1]][parts.slice(2).join('.')] = value;
        } else {
          d.config[parts[1]] = value;
        }
        return;
      }

      if (parts[0] === '_hidden') return;

      var table = parts[0];
      var field = parts[parts.length - 1];
      var rowKey = parts.slice(1, -1).join('.');
      var rows = d[table];
      var keyOf = ROW_KEY[table];
      if (!rows || !keyOf) return;

      var row = null;
      for (var i = 0; i < rows.length; i++) {
        if (keyOf(rows[i]) === rowKey) { row = rows[i]; break; }
      }

      // An edit against a row that does not exist yet creates it, so adding a
      // month for a seller works from the UI without a separate "new row" flow.
      if (!row) {
        var bits = rowKey.split('|');
        row = { _key: bits[0], seller: bits[0], month: bits[1] || '', _added: true };
        if (table === 'onboarding' || table === 'employees') { row.name = bits[0]; delete row.seller; }
        rows.push(row);
      }
      row[field] = value;
    });

    // Recompute derived config the same way parse.js does, so an edited rate
    // moves the factor that depends on it.
    var c = d.config;
    if (!this.edits['config.employerFactor']) {
      c.employerFactor = 1 + (c.agaRate || 0) + (c.holidayRate || 0) + (c.pensionRate || 0);
    }
    if (!this.edits['config.workdaysPerMonth']) {
      c.workdaysPerMonth = (c.workdaysPerYear || 260) / 12;
    }
    if (!this.edits['config.maxSickBase']) {
      c.maxSickBase = (c.grunnbelop || 0) * 6;
    }
    if (!this.edits['config.onbTotal']) {
      c.onbTotal = ['onbAdvertising', 'onbFee', 'onbCourse', 'onbTraining', 'onbEquipment']
        .reduce(function (a, k) { return a + (c[k] || 0); }, 0);
    }

    // Drop anything the user has hidden before the model ever sees it.
    var self2 = this;
    Object.keys(ROW_KEY).forEach(function (table) {
      if (!d[table]) return;
      d[table] = d[table].filter(function (r) {
        return !self2.edits['_hidden.' + table + '.' + ROW_KEY[table](r)]; });
    });

    // Months follow whatever data is present, including anything just added.
    var months = {};
    ['sales', 'hr', 'bonus'].forEach(function (k) {
      (d[k] || []).forEach(function (r) { if (r.month) months[r.month] = 1; });
    });
    d.months = Object.keys(months).sort();
  };

  Store.prototype.recompute = function () {
    this.dataset = this.build();
    this.model = global.VenditusModel.compute(this.dataset);
    return this.model;
  };

  /* ── the write path ───────────────────────────────────────────────────── */

  Store.prototype.get = function (path) {
    if (this.edits[path] !== undefined) return this.edits[path];
    var parts = path.split('.');
    if (parts[0] === 'config') {
      var c = this.dataset.config;
      if (parts[1] === 'packRates') return (c.packRates || {})[parts[2]];
      if (parts[1] === 'sellerShare') return (c.sellerShare || {})[parts.slice(2).join('.')];
      if (parts[1] === '_label' || parts[1] === '_source') return (c[parts[1]] || {})[parts.slice(2).join('.')];
      return c[parts[1]];
    }
    var rows = this.dataset[parts[0]] || [];
    var keyOf = ROW_KEY[parts[0]];
    var rowKey = parts.slice(1, -1).join('.');
    var field = parts[parts.length - 1];
    for (var i = 0; i < rows.length; i++) {
      if (keyOf && keyOf(rows[i]) === rowKey) return rows[i][field];
    }
    return undefined;
  };

  /* ── history ───────────────────────────────────────────────────────────
     A spreadsheet without undo is not one people will trust their month to.
     Snapshots are of the whole edit overlay, which is small (a few hundred
     keys at most) and makes correctness trivial. */

  Store.prototype.snapshot = function () {
    this.undoStack = this.undoStack || [];
    this.undoStack.push(JSON.stringify(this.edits));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  };

  Store.prototype.undo = function () {
    if (!this.undoStack || !this.undoStack.length) return false;
    (this.redoStack = this.redoStack || []).push(JSON.stringify(this.edits));
    this.edits = JSON.parse(this.undoStack.pop());
    this.persist(); this.recompute(); this.emit();
    return true;
  };

  Store.prototype.redo = function () {
    if (!this.redoStack || !this.redoStack.length) return false;
    (this.undoStack = this.undoStack || []).push(JSON.stringify(this.edits));
    this.edits = JSON.parse(this.redoStack.pop());
    this.persist(); this.recompute(); this.emit();
    return true;
  };

  Store.prototype.canUndo = function () { return !!(this.undoStack && this.undoStack.length); };
  Store.prototype.canRedo = function () { return !!(this.redoStack && this.redoStack.length); };

  Store.prototype.set = function (path, value) {
    this.snapshot();
    this.edits[path] = value;
    this.persist();
    this.recompute();
    this.emit();
    return this.model;
  };

  // A paste is one edit, not two hundred: one snapshot, one recompute, one render.
  Store.prototype.setMany = function (pairs) {
    if (!pairs || !pairs.length) return this.model;
    this.snapshot();
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i][1] === null || pairs[i][1] === undefined) delete this.edits[pairs[i][0]];
      else this.edits[pairs[i][0]] = pairs[i][1];
    }
    this.persist();
    this.recompute();
    this.emit();
    return this.model;
  };

  Store.prototype.clearEdit = function (path) {
    delete this.edits[path];
    this.persist();
    this.recompute();
    this.emit();
  };

  Store.prototype.reset = function () {
    this.snapshot();
    this.edits = {};
    this.persist();
    this.recompute();
    this.emit();
  };

  /* ── adding and removing rows ──────────────────────────────────────────
     The workbook has fixed row capacity (50 sales / 51 HR / 54 bonus / 20
     employees) and runs out at about twenty people. Clario has no such limit:
     rows live in the edit overlay, so adding one is just another edit. */

  Store.prototype.addRow = function (table, parts) {
    var key = this.rowKeyFor(table, parts);
    if (!key) return null;
    var seed = { sales: 'commission', hr: 'selfCertDays', bonus: 'amount',
                 onboarding: 'advertising', employees: 'contract' }[table];
    // write one field so applyEdits() materialises the row on the next build
    this.snapshot();
    this.edits[table + '.' + key + '.' + (seed || 'note')] =
      table === 'employees' ? (parts.contract || 'Fast + Provisjon') : 0;
    // keep the display name the user typed; the key stays case-folded
    var display = parts.seller || parts.name;
    if (display) {
      this.edits[table + '.' + key + '.' + (table === 'onboarding' || table === 'employees' ? 'name' : 'seller')] = display;
    }
    if (parts.month) this.edits[table + '.' + key + '.month'] = parts.month;
    if (table === 'employees') this.edits[table + '.' + key + '.active'] = true;
    if (table === 'bonus') this.edits[table + '.' + key + '.description'] = parts.description || '';
    this.persist(); this.recompute(); this.emit();
    return key;
  };

  Store.prototype.rowKeyFor = function (table, p) {
    var name = String(p.seller || p.name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!name) return null;
    if (table === 'onboarding' || table === 'employees') return name;
    if (!p.month) return null;
    if (table === 'bonus') return name + '|' + p.month + '|' + (p.description || 'ny');
    return name + '|' + p.month;
  };

  // Hiding beats deleting: the workbook row stays, we just stop counting it,
  // and "restore" is one click rather than a re-import.
  Store.prototype.hideRow = function (table, key) {
    this.snapshot();
    this.edits['_hidden.' + table + '.' + key] = true;
    this.persist(); this.recompute(); this.emit();
  };

  Store.prototype.showRow = function (table, key) {
    delete this.edits['_hidden.' + table + '.' + key];
    this.persist(); this.recompute(); this.emit();
  };

  Store.prototype.isHidden = function (table, key) {
    return this.edits['_hidden.' + table + '.' + key] === true;
  };

  Store.prototype.editCount = function () {
    return Object.keys(this.edits).filter(function (k) { return k.indexOf('_hidden.') !== 0; }).length; };
  Store.prototype.isEdited = function (path) { return this.edits[path] !== undefined; };

  /* ── importing a different workbook at runtime ────────────────────────── */

  Store.prototype.importRaw = function (raw) {
    this.loadWorkbook(raw, this.demo, false);
    this.emit();
    return { diagnostics: this.diagnostics, model: this.model };
  };

  global.VenditusStore = new Store();
  global.VenditusStore.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
