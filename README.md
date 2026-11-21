# Ovid Calculator

A scientific calculator that keeps track of units, exact fractions and measurement error. If you ignore those features it behaves like any other calculator.

**[Open the live app →](https://denizsev.github.io/ovid-calculator/)**

![Ovid Calculator](docs/screenshot.jpg)

## Features

- **Unit-aware maths**: put a unit after a number. The result works out its own unit and rejects operations on mismatched units.
- **Error bars**: carries the uncertainty of a measurement through the whole calculation.
- **Fraction mode**: shows the exact value instead of a rounded decimal.
- **Warp mode**: walks through the order of operations step by step instead of jumping to the answer.
- **"What if?"**: tap a number on the display, it turns into a slider, and the result follows it live.
- **Scientific keys**: trigonometry, logarithms, powers, factorial, mod; `2nd` opens the inverse functions.
- **Number tools**: prime factors, GCD/LCM, base conversion (2/8/10/16), list statistics.
- **Analytic geometry**: a second page that plots functions, points and circles with the same engine.
- **Six languages**: English, Deutsch, Türkçe, Français, Español, 中文. Missing strings fall back to English.
- **Offline and installable**: a service worker caches the app, and it can be added to the home screen.
- **Private by design**: no server, no analytics, no third-party requests. Settings and history are only stored if you allow it.

## Keyboard shortcuts

| Key | Action |
|---|---|
| digits, `+ - * /`, `( )` | type the expression |
| function or unit names | type them directly |
| `Enter` | calculate |
| `Backspace` | delete the last character |
| `Delete` | clear everything |
| `Esc` | close a panel / clear |
| `%` | percent (`50+10%` = 55) |

## Tech stack

Plain HTML, CSS and JavaScript with no framework and no build step.

| File | Role |
|---|---|
| `engine.js` | tokenizer, parser (shunting-yard to RPN, then AST), exact rationals, units |
| `geometri.js` | analytic geometry page |
| `i18n.js` | translations, applied through `data-i18n` attributes |
| `sw.js`, `manifest.json` | offline cache and install |
| `privacy.js` | storage consent gate |

## Run locally

```bash
git clone https://github.com/denizsev/ovid-calculator.git
cd ovid-calculator
python3 -m http.server 8000
```

Then open http://localhost:8000. A local server is needed for the service worker; opening `index.html` directly also works without offline support.

## Deployment

Every push to `main` deploys to GitHub Pages through [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

## More

- [ROADMAP.md](ROADMAP.md): research notes and next steps
- [SECURITY.md](SECURITY.md): threat model
