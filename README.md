# Clario

Design prototype for Clario — an accounting workspace that replaces spreadsheet
workpapers. Built for the Phonero demo.

The premise: accountants do their real work in Excel. Clario imports those
workbooks, keeps their formulas and provenance intact, and layers review,
insight and scenario planning on top.

---

## Running it

The pages are self-contained HTML. Any static server works:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Then open **http://127.0.0.1:8080/Overview.dc.html**

> **Needs an internet connection.** `support.js` pulls React and Babel from
> unpkg, and the pages load fonts from Google. Worth checking the wifi before a
> demo.

> **Chrome caches these aggressively.** If an edit doesn't show up, append
> `?v=2` (any number) rather than reaching for a hard reload.

---

## Pages

| File | What it is |
|---|---|
| `Overview.dc.html` | The app — dashboard, cashflow, insights, import, workpapers index, scenarios, chat, and the five Venditus micro-level views |
| `Sheet.dc.html` | Full-screen spreadsheet editor, opened per workbook + period |
| `Insight.dc.html` | Insight detail page, opened per insight |

Both sub-pages take query parameters:

```
Sheet.dc.html?file=Phonero_Template_EN.xlsx&period=Juni%202026&client=Phonero%20AS&lang=no
Insight.dc.html?id=ads          # ads | concentration | cash | contractors
```

Everything is bilingual — `?lang=no` / `?lang=en`, or the NO/EN toggle in the
header. Norwegian is the default and the reference.

---

## The Venditus layer

`Venditus_v2_Mikro_final.xlsx` (8 sheets) is the client's data standard. It is read into
one live store; changing any number anywhere recomputes the whole site.

```
venditus/mapping.js   sheet + column + config-key → field   ← edit this when the workbook changes
venditus/parse.js     raw cells → dataset + diagnostics
venditus/model.js     all 34 BEREGNING columns + roll-ups   ← the client's rules, pure
venditus/store.js     dataset + user edits → recompute → notify
venditus/raw.js       generated from the workbook (python3 tools/xlsx-to-raw.py <file>)
venditus/demo.js      generated transactions (node tools/seed-demo.mjs)
```

### Arbeidsbok — the point of the whole thing

Excel is **replaced**, not imported. All eight sheets live inside Clario as editable grids
under the **Arbeidsbok** route: real column letters, the workbook's own Norwegian headers,
and its own colour code (yellow = you type here, green = computed, orange = external).

- The five input sheets are grids of live `<input>`s — Tab moves between cells natively, so
  there is no selection state to keep in sync.
- **BEREGNING PER SELGER** is not editable and not stored. All 34 columns (A→AH) are computed
  by `model.js` and recalculate as you type in the other sheets — which is what the Excel
  formulas were doing.
- **NAV INN & UT** derives quarterly employer tax and the day-17 refunds from the same rows as
  the rest of the model, so they cannot drift from payroll cost.
- Rows can be added and hidden on **every** sheet — including a brand-new seller, typed by
  name. The workbook has fixed capacity (50 sales / 51 HR / 54 bonus / 20 employees) and runs
  out around twenty people; Clario has no limit, because rows live in the edit overlay.

### It behaves like a spreadsheet

Excel is only replaced if the daily motions work, so the grid supports them:

| | |
|---|---|
| **Paste from Excel** | TSV, any size, lands from the focused cell. One undo entry, one recompute — a 200-cell paste is not 200 renders. Read-only columns are skipped and reported. |
| **Copy** | The selection leaves as TSV, so it pastes straight back into Excel. |
| **Undo / redo** | `⌘Z` / `⌘⇧Z` / `⌘Y`, 80 deep. Snapshots the whole edit overlay, so correctness is trivial. Works anywhere on the route, not just when a cell has focus. |
| **Navigation** | Arrows, Enter, Tab, Shift-Tab, Home/End. Arrows move between cells while the value is fully selected, and move the caret once you click into the text. |
| **Selection** | Shift-arrows, shift-click, `⌘A`. Painted directly on the DOM — a drag must not re-render 350 inputs. |
| **Fill down** | `⌘D` over a selection. |
| **Clear** | Delete/Backspace on a selection. |

`venditus/store.js` provides `setMany()` and the undo stack; the interaction layer lives in
`vdBindGrid()` and is delegated on `document`, like the rest of the injected-HTML handlers.

Import remains the on-ramp for a **new** client. After that, nobody opens Excel again.

### Every number knows its cell

`venditus/trace.js` maps each model field back to its sheet, column and — when a seller and
month are known — the exact row, using the `_row` `parse.js` records rather than a position in
a re-sorted table. Two surfaces consume it:

- `vdRowAttrs(metric, ctx)` makes a **whole row** clickable — the row itself carries
  `data-vd-act="cell"`, so the entire line navigates, not just the chip.
- `vdTT(title, rows, foot, act)` wraps `ttHTML` in a `.tt` card shown on `.vd-hov:hover`, so
  every row and every column of every chart has the same detail card the older SVG charts use:
  the basis, the rate, the amount, the share, a drill link and a footnote explaining the rule.
- `vdSrc(metric, ctx)` renders the small `KONF!B4 →` chip where only a marker is wanted.
- `ttHTML`'s `act` argument takes `{trace}` and renders the same link inside a chart tooltip.

Both emit `data-vd-act="cell"`, handled in `vdBind()`: it opens Arbeidsbok on the right sheet,
then `vdJump()` (called from `componentDidUpdate`) scrolls to the target and pulses it. A
company-level figure has no single owning row, so it highlights the whole **column** that feeds
it; filter to one seller and the same metric resolves to a single cell.

The round trip is the point: read AGA on the dashboard → click `KONF!B4` → change 14,1 % to
18 % in the cell it lands on → return, and that same line has moved.

### Cross-filtering

`state.vdFocus` scopes the page in place (distinct from `vdSeller`, which navigates to the
detail view). Click any seller in the contribution chart and every KPI, chart and total on
Oversikt and Kontantstrøm re-scopes, with a dismissable chip showing what is applied.

Four reporting routes read the same model: **Selgere** (per-seller, filterable, click through
to one person's month), **Provisjon** (per-pack, reconciled against Phonero), **Fravær & NAV**,
and **Onboarding**.

**Nothing may cache its own copy of the data.** `store.js` notifies on every edit and the
subscriber in `vdBind()` clears `_wb`, `_fs` and `_c` before re-rendering. Miss one and half
the page keeps showing the previous numbers.

`PHONERO RAPPORT` ships **empty**, so with the real file alone there is nothing to display.
`demo.js` supplies transactions in the same shape while employees and every rate still come
from Kian's file; each page carries a DEMO badge saying so. A workbook with real sales rows
replaces it automatically.

### Six defects in the workbook, corrected here

1. `BEREGNING!E5` (commission) and `X5` (revenue) are **byte-identical formulas**, so margin
   can never be positive. We split them: revenue is Σ(count × pack rate); the seller's
   commission is a share of it per contract type. **That share does not exist in the workbook
   — the 65/50/35 % defaults are an assumption awaiting Kian.**
2. `D5`/`V5` hold the text `"← Tripletex"`, so `W5 = IFERROR(R5+…+V5, 0)` evaluates to **0** and
   every margin reads 100 %. We exclude them from the total and label them as pending.
3. `ONBOARDING!J5` divides by `(B26+B27+B28+B29)/4`, but `B26` is *"Trekkperiode før
   avregning"* — 3 months, not a rate. We average the pack rates only.
4. The per-pack counts (`PHONERO RAPPORT` D–J) are referenced by **no formula anywhere**.
   Computing Σ(count × rate) and reconciling it against Phonero's lump total is the control
   Venditus does not have today — and the reason the Provisjon page exists.
5. 6G is loaded into `KONFIGURASJON` and never referenced, so NAV refund is uncapped. The cap
   is applied here.
6. Sellers join by exact name across four sheets with **zero** validation rules in the file.
   Names are normalised and every mismatch is reported as a diagnostic.

Also worth knowing: the file has **no cached formula results** (generated by script, never
opened in Excel), and `PHONERO RAPPORT` has a *Phonero 1GB* count column with no matching rate
in `KONFIGURASJON` — it is treated as kr 0 and flagged in the UI.

### Why the sheet engine is not used for this

`fEval` supports exactly three functions — `SUM`, `ROUND`, `KONTO` — has no comparison
operators, and its identifier charset excludes `$` and `'`. It cannot tokenise `C$5:C$55` or
`'HR INPUT'!C5`, let alone evaluate `SUMIFS`/`INDEX`/`MATCH`/`IFERROR`. `model.js` computes
everything instead; the Sheet view stays read-only.

---

## Oversikt and Kontantstrøm

**Oversikt** — computed-vs-reported revenue trend, a cost cascade from revenue down to
contribution margin (each line with its source), ranked contribution per seller (the
cross-filter entry point), revenue per pack with the Phonero reconciliation, and an absence
trend against the 6 % threshold.

**Kontantstrøm is accrual, not cash.** The workbook holds no bank data, so there is no balance
and no runway — inventing either would be a lie. Instead it answers *what do we owe, and when*:

- money in vs out per month (revenue + NAV refunds against payroll, bonus, onboarding, lists);
- **Forpliktelser** — employer tax by quarter with its statutory due dates, holiday pay
  accruing at 12 % against a once-a-year payout, pension at 2 %, and unpaid bonuses read from
  `BONUS REGISTER`'s own `Utbetalt` flag;
- **NAV-balanse** — expected refund vs received, i.e. what NAV still owes;
- cost composition by category over time.

`model.js` computes these in `accruals()`; `cascade()` produces the revenue-to-margin steps.
The old `flowSeries()` and `wfMonths()` demo arrays no longer reach either page.

---

## Where the numbers come from

The demo is built on a real client file, `Phonero_Template_EN.xlsx` — two
sheets, 41 rows, 48 formulas.

`Sheet.dc.html` reproduces that workbook exactly: labels, formulas
(`=SUM(B2:H2)`, `=B4-B7-B16-B34`), the blank spacer rows, `"kr "#,##0;[RED]`
negatives, the cell comments, and the `Margin Model` island that starts at G4
and holds no formulas at all.

`Overview.dc.html` recomputes the same P&L from the same series, so the
dashboard and the workpaper can never disagree. **June EBIT is `kr 1 026 110` on
both pages** — a useful assertion if either side changes.

---

## Two runtime traps

Both cost real debugging time. Read before hand-writing a new `.dc.html`:

**1 · `dangerouslySetInnerHTML` does not work in a hand-written file.**
camelCase props get lowercased to `dangerouslysetinnerhtml`, React ignores them,
and the value lands as a literal attribute. Only known handlers like `onClick`
survive. `Overview.dc.html` gets away with it because that file came out of the
Design tool rather than being typed by hand.

**2 · `{{ }}` inside an SVG `<text>` never paints.**
The runtime wraps every interpolation in an HTML `<span class="sc-interp">`,
which SVG cannot render. Paths and circles work fine; text silently gets a 0×0
bounding box.

The fix for both: paint the SVG into a `<div data-chart="…">` mount point from
`componentDidMount` / `componentDidUpdate`, keyed so it only repaints when the
inputs change. See `Insight.dc.html`.

---

## Known debt

- The Venditus **seller share** (65/50/35 % by contract type) is Clario's assumption, not the
  client's data. Confirm with Kian before anyone reads the margin as fact.
- Import still does not parse an uploaded file — the dropzone is the original mock. The
  parser it needs is already written and shared (`venditus/parse.js`); it needs `FileReader`
  + SheetJS wiring and a mapping-health panel. Until then a new workbook is loaded by
  re-running `tools/xlsx-to-raw.py`.
- There is no `.xlsx` export yet, so edits made in Clario cannot be handed back to Kian.
- No column resize, no multi-sheet paste, no find-and-replace within a sheet.
- The `venditus/*.js` script tags carry a content hash (`?h=…`) so an edit always reloads.
  Regenerate with the stamping step if you add a file.
- Dara, Scenarios, Invoices and the Insights page still run on their own demo literals and do
  not follow a Venditus edit.
- `flowSeries()`, `wfMonths()`, `buildExpenseStack()`, `buildRunwayArc()`, `buildNetDiverge()`
  and `buildWaterfall()` are now unreferenced by any route — dead, and safe to delete.
- `sheetHref()` still hardcodes the old Phonero file/period/client, and its target's deep-link
  regex rejects two-letter columns. Only the legacy `.tta` links use it; the Venditus drill-
  through does not.

- `Overview.dc.html` still carries the original inline workpaper grid and the
  retired import mapping canvas as dead code. Nothing renders them.
- The spreadsheet engine (formula evaluator, editing, clipboard, fill) is
  duplicated between `Overview.dc.html` and `Sheet.dc.html`. Correct for a
  prototype, wrong for production — it should be one module.
- Insights content is hardcoded and gated behind a demo Premium switch that
  unlocks instantly. There is no payment flow.
