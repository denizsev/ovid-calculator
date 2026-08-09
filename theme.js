/* =====================================================================
   OVID — THEME (light / dark)

   Starts dark on every first visit, matching the instrument's identity.
   A saved choice carries across all three pages through the same
   consent-gated storage as every other preference (see privacy.js, where
   THEME_KEY is declared under the "preferences" group) — declined
   consent simply means the choice lasts for the current visit only.
   ===================================================================== */

const THEME_KEY = "ovid-theme";

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);

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
