# Roadmap

Where Ovid stands and what comes next. The full research notes (competitor analysis, user complaints, design decisions) are kept in Turkish in [`notes/ROADMAP.tr.md`](notes/ROADMAP.tr.md).

## Idea

A calculator for people who think in orders of magnitude, and one that does not lie about precision: units, measurement error and exact fractions are carried through every step.

## Done

**Engine**
- No `eval()`: tokenizer → shunting-yard → AST, with correct precedence (`2^3^2 = 512`, `-2^2 = -4`) and implicit multiplication (`2π`, `2(3+4)`)
- Every number is a `Quantity`: value, uncertainty, unit dimensions and, where possible, an exact BigInt fraction
- Exact arithmetic: `(0.1 + 0.2) × 3 − 0.9` gives `0`, `sqrt(4/9)` gives `2/3`
- Error propagation (Gauss, analytic derivatives), unit analysis (`100 km / 2 h = 50 km/h`, `5 km + 3 kg` is rejected)
- Maths audit fixes: `-7 mod 3 = 2`, `50 + 10% = 55`, `tan(90)` reported as undefined, domain errors explained

**Features**
- Warp mode (step-by-step reduction), "what if?" sliders, fraction mode
- Scientific keys, DEG/RAD, memory, undo/redo, history, copy on click
- Number tools: prime factors, GCD/LCM, base conversion, list statistics
- Unit converter and constants library; analytic geometry page
- Six languages, three text sizes, offline PWA, privacy gate for storage
- Accessibility: `aria-label` on symbol keys, focus trap in dialogs, `aria-live` results, reduced motion

## Next

1. **Significant-figures mode.** Rules are researched: addition follows the fewest decimals, multiplication the fewest significant figures, intermediate results are not rounded. Needs a `{figs, decimals}` field on `Quantity`.
2. **Automated tests and CI** for the engine (parser, exact arithmetic, error propagation).
3. **Shareable state**: put the expression in the URL.
4. **History export** (CSV).
5. **Constellation history**: each calculation becomes a star you can click to restore it.
6. **Cosmic scale hints**: "1.2×10¹² m ≈ 8 AU".
7. **Orbital mechanics pack**: escape velocity, delta-v, orbital period, light travel time.

## Known limit

Gaussian propagation assumes independent variables, so correlated expressions such as `x × x` overestimate the error. Fixing this needs variable identity tracking inside the expression.
