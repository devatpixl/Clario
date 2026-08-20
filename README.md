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
| `Overview.dc.html` | The app — dashboard, cashflow, insights, import, workpapers index, scenarios, chat |
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

- `Overview.dc.html` still carries the original inline workpaper grid and the
  retired import mapping canvas as dead code. Nothing renders them.
- The spreadsheet engine (formula evaluator, editing, clipboard, fill) is
  duplicated between `Overview.dc.html` and `Sheet.dc.html`. Correct for a
  prototype, wrong for production — it should be one module.
- Insights content is hardcoded and gated behind a demo Premium switch that
  unlocks instantly. There is no payment flow.
