/* =====================================================================
   OVID — THEME (light / dark)

   Starts dark on every first visit, matching the instrument's identity.
   A saved choice carries across all three pages through the same
   consent-gated storage as every other preference (see privacy.js, where
   THEME_KEY is declared under the "preferences" group) — declined
   consent simply means the choice lasts for the current visit only.
   ===================================================================== */

const THEME_KEY = "ovid-theme";

/* Must match --ground in each theme's token block in style.css. The browser
   paints its own chrome (the mobile address bar, the PWA title bar) from
   this, and it is read from markup rather than CSS, so it cannot pick the
   value up from a custom property — leaving it fixed meant a near-black bar
   sitting above a pale page in light mode. */
const THEME_COLORS = { dark: "#05070d", light: "#e7edf3" };

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLORS[theme] || THEME_COLORS.dark);

    document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
        const isLight = theme === "light";
        btn.textContent = isLight ? "☀️" : "🌙";
        btn.setAttribute("aria-pressed", String(isLight));
    });

    // canvas-drawn content (the analytic-geometry plane) can't pick up CSS
    // variable changes on its own — it needs telling
    document.dispatchEvent(new CustomEvent("ovid-theme-change", { detail: { theme } }));
}

let currentTheme = storeGet(THEME_KEY) === "light" ? "light" : "dark";
applyTheme(currentTheme);

document.addEventListener("click", event => {
    const btn = event.target.closest("[data-theme-toggle]");
    if (!btn) return;

    currentTheme = currentTheme === "light" ? "dark" : "light";
    storeSet(THEME_KEY, currentTheme);
    applyTheme(currentTheme);
});
