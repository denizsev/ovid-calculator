# Security

Ovid Calculator is a static site with no server, no accounts, no analytics and
no third-party requests. That removes most of the categories a web app usually
has to defend — there is no session to steal, no API to authorise, no database
to inject into. What remains is documented here, honestly, including the parts
that cannot be fixed from a static host.

## Threat model

| Asset | Exposure |
|---|---|
| What you type | Never leaves the browser. There is no endpoint to send it to. |
| What is stored | `localStorage` only, on your own device, behind the consent gate in `privacy.js`. |
| Mission Control submissions | Stay local until *you* click through to GitHub, which opens a prefilled issue form you review before posting. |

The realistic attackers are therefore: someone who gets a script onto the page
(XSS), someone who can serve modified assets (a compromised host or cache), and
someone who feeds the app malformed input or storage.

## Controls in place

**Content Security Policy.** Every page ships a strict policy via
`<meta http-equiv="Content-Security-Policy">`:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self';
base-uri 'none'; form-action 'none'
```

It starts from `default-src 'none'` and re-allows only same-origin loads. There
is no `'unsafe-inline'` and no `'unsafe-eval'` anywhere, which is possible only
because the markup contains **zero** inline `<script>`, inline `<style>`,
`style="…"` attributes and `onclick=`-style handlers — all behaviour lives in
external files. `base-uri 'none'` blocks `<base>` injection; `form-action 'none'`
blocks form-based exfiltration (both forms on the site are handled with
`preventDefault()` and never actually submit).

**No dynamic code execution.** There is no `eval()`, no `new Function()`, and no
string-argument `setTimeout`/`setInterval` in the codebase. The expression
engine is a hand-written tokenizer → shunting-yard → AST evaluator, so user
input is *parsed*, never executed.

**Untrusted input renders as text, never as markup.** Everything a user or a
fetched file supplies — submission titles, details, contributor names — goes
through `textContent` or `setAttribute`. The only `innerHTML` writes in the
codebase are in `privacy.js` and interpolate nothing but compile-time constants
(`STORAGE_GROUPS`) and static translation strings.

**Prototype-safe lookups.** Every table keyed by a user-typed name
(`FUNCTIONS`, `UNITS`, `CONSTANTS`, `VARIABLES`) is built with a null
prototype. Without this, `FUNCTIONS["constructor"]` resolved to `Object` and
`UNITS["hasOwnProperty"]` made `5 hasOwnProperty` parse as a dimensioned value
that silently evaluated to `NaN`.

**Resilient parsing of stored data.** Every `JSON.parse` of `localStorage` is
wrapped and shape-validated. Corrupt or hostile stored values are discarded
rather than propagated, and cannot prevent the app from starting.

**Denial-of-service bounds.** Factorial is capped (`n > 170` → `Infinity`, the
exact BigInt path at 40), the step-evaluation walker has an iteration guard, and
the tokenizer scans character-by-character rather than with backtracking-prone
regular expressions, so no input causes catastrophic backtracking.

**Service worker.** Only same-origin `GET`s with `response.ok` and
`response.type === "basic"` are cached, so a transient 404 or 502 cannot be
written into the offline cache and served from it afterwards.

**Referrer suppression.** `<meta name="referrer" content="no-referrer">` means
that even the one outbound link (to GitHub, on your explicit click) does not
disclose where you came from.

**Outbound links.** `window.open(..., "noopener")` prevents the opened page from
reaching back through `window.opener`. The URL is built from a hardcoded
`https://github.com/` prefix with every user-supplied part `encodeURIComponent`-
encoded, so no scheme or parameter injection is possible.

## Known limits

These are not oversights — they are the boundary of what a static GitHub Pages
site can enforce, and it would be wrong to claim otherwise:

- **No HTTP response headers.** GitHub Pages does not let a project set them, so
  `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Cross-Origin-Opener-Policy` and a header-delivered CSP are unavailable. The
  meta-tag CSP covers most of the same ground; the rest does not.
- **`frame-ancestors` cannot be enforced.** It is ignored in a meta policy by
  specification, and `X-Frame-Options` needs a header. The site can therefore be
  framed. With no login, no session and no privileged action that a single
  blind click completes (erasing data requires a `confirm()`), the practical
  clickjacking exposure is low, but it is non-zero.
- **Trust in the host.** Anyone who could modify what GitHub Pages serves could
  serve anything. The mitigation is that the source is public and every claim on
  the privacy page can be checked against it.
- **The device itself.** Data stored locally is protected by the browser and the
  operating system. A compromised device, or another script running on the same
  origin, is outside what this site can defend against.

## Reporting

Found something? Open an issue at
<https://github.com/denizsev/ovid-calculator/issues>. There is no user data at
risk to embargo, so public reports are fine.
