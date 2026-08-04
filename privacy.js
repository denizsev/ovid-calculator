/* =====================================================================
   OVID CALCULATOR — PRIVACY & STORAGE CONSENT

   Most calculator sites show a consent wall listing hundreds of advertising
   partners. We have none: no server, no analytics, no advertising, no
   third-party requests of any kind — the font is served from our own origin
   precisely so that not even an IP address leaves the browser.

   What is left is genuine, though, and Article 5(3) of the ePrivacy Directive
   covers it: writing to localStorage is "storing information on a user's
   terminal equipment" whether or not it is technically a cookie. So this
   module does three things:

     1. Declares honestly what is stored, key by key, grouped by purpose.
     2. Gates the storage layer, so a declined group genuinely cannot be
        written — the toggles are wiring, not decoration.
     3. Makes withdrawal exactly as cheap as consent: one link, always
        present, and erasing everything is one button away.

   Nothing here is copied from another site; the categories are derived from
   this app's own storage inventory.
   ===================================================================== */

const CONSENT_KEY = "ovid-consent";
const CONSENT_VERSION = 1;

/* The complete inventory. If a key is not listed here it cannot be written:
   unknown keys fall through to "denied", so adding storage without declaring
   it fails loudly during development rather than silently in production. */
const STORAGE_GROUPS = [
    {
        id: "essential",
        required: true,
        keys: [CONSENT_KEY, "ovid-lang"]
    },
    {
        id: "preferences",
        required: false,
        keys: ["ovid-angle", "ovid-sound", "ovid-size", "ovid-step",
               "ovid-fraction", "ovid-seen-help"]
    },
    {
        id: "work",
        required: false,
        keys: ["ovid-history", "ovid-memory"]
    },
    {
        id: "community",
        required: false,
        keys: ["ovid-profile", "ovid-entries"]
    }
];

const GROUP_OF = {};
for (const group of STORAGE_GROUPS) {
    for (const key of group.keys) GROUP_OF[key] = group.id;
}

// ---------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------

/* Read straight from localStorage rather than through storeGet, because the
   gate is not installed yet and storeGet would be answering about itself. */
function readConsent() {
    let raw = null;
    try {
        raw = window.localStorage.getItem(CONSENT_KEY);
    } catch (e) {
        return null;
    }
    if (!raw) return null;

    try {
        const saved = JSON.parse(raw);
        if (!saved || saved.v !== CONSENT_VERSION) return null;
        return saved;
    } catch (e) {
        return null;
    }
}

const saved = readConsent();

/* Default is "off" for everything optional. Nothing is pre-ticked, which is
   what Article 7 and the EDPB consent guidelines require — silence is not
   consent, so an undecided visitor is treated exactly like one who declined. */
let consent = {
    essential: true,
    preferences: saved ? saved.preferences === true : false,
    work: saved ? saved.work === true : false,
    community: saved ? saved.community === true : false
};

let decided = saved !== null;

function persistConsent() {
    const record = {
        v: CONSENT_VERSION,
        at: new Date().toISOString(),
        preferences: consent.preferences,
        work: consent.work,
        community: consent.community
    };
    try {
        window.localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
    } catch (e) {
        /* private mode — the choice then lasts for this visit only */
    }
    decided = true;
}

// ---------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------

setStorageGate((key) => {
    const group = GROUP_OF[key];
    if (!group) return false;          // undeclared key — never persisted
    if (group === "essential") return true;
    return consent[group] === true;
});

/* Turning a group off has to remove what it already wrote, otherwise the
   choice would only apply going forward and the old data would sit there. */
function purgeGroup(id) {
    const group = STORAGE_GROUPS.find(g => g.id === id);
    if (!group) return;
    for (const key of group.keys) {
        try {
            window.localStorage.removeItem(key);
        } catch (e) {
            /* nothing to clean up */
        }
    }
}

function applyConsent() {
    for (const group of STORAGE_GROUPS) {
        if (!group.required && !consent[group.id]) purgeGroup(group.id);
    }
}

/* Re-persist whatever the app already holds in memory for a group that has
   just been switched on, so agreeing keeps this session rather than losing it. */
function flushGroup(id) {
    const group = STORAGE_GROUPS.find(g => g.id === id);
    if (!group) return;
    for (const key of group.keys) {
        if (memoryStore[key] === undefined) continue;
        try {
            window.localStorage.setItem(key, memoryStore[key]);
        } catch (e) {
            /* quota or private mode — in-memory still works */
        }
    }
}

// ---------------------------------------------------------------------
// DATA CONTROLS
// ---------------------------------------------------------------------

/* Every key this app owns, with whatever is currently on the device. */
function collectStoredData() {
    const out = {};
    for (const group of STORAGE_GROUPS) {
        for (const key of group.keys) {
            let value = null;
            try {
                value = window.localStorage.getItem(key);
            } catch (e) {
                value = null;
            }
            if (value !== null) out[key] = value;
        }
    }
    return out;
}

function storedByteCount() {
    let bytes = 0;
    const data = collectStoredData();
    for (const key in data) bytes += key.length + data[key].length;
    return bytes;
}

/* Right of access, Article 15 — as a file the visitor can actually keep.
   It is built entirely in the browser; nothing is uploaded to produce it. */
function exportData() {
    const payload = {
        exportedAt: new Date().toISOString(),
        source: location.origin + location.pathname,
        note: "Everything Ovid Calculator has stored on this device.",
        consent: readConsent(),
        data: collectStoredData()
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)],
                          { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "ovid-my-data.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Right to erasure, Article 17. Clears the device and reloads so the app
   comes back in exactly the state a first-time visitor would see. */
function eraseEverything() {
    for (const group of STORAGE_GROUPS) {
        for (const key of group.keys) {
            try {
                window.localStorage.removeItem(key);
            } catch (e) {
                /* nothing to clean up */
            }
            delete memoryStore[key];
        }
    }

    if ("caches" in window) {
        caches.keys()
            .then(keys => Promise.all(keys.map(k => caches.delete(k))))
            .catch(() => { /* offline cache is a bonus, not a requirement */ });
    }

    location.reload();
}

// ---------------------------------------------------------------------
// BANNER
// ---------------------------------------------------------------------

let banner = null;

function buildBanner() {
    if (banner || decided) return;

    banner = document.createElement("section");
    banner.className = "privacy-banner";
    banner.id = "privacy-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-modal", "false");
    banner.setAttribute("aria-labelledby", "privacy-banner-title");

    banner.innerHTML =
        '<div class="privacy-banner-body">' +
            '<h2 id="privacy-banner-title" data-i18n="privacy.bannerTitle"></h2>' +
            '<p data-i18n="privacy.bannerText"></p>' +
            '<p class="privacy-banner-note" data-i18n="privacy.bannerNote"></p>' +
        '</div>' +
        '<div class="privacy-banner-actions">' +
            '<button type="button" class="privacy-btn" id="privacy-essential" data-i18n="privacy.essentialOnly"></button>' +
            '<button type="button" class="privacy-btn privacy-btn-accept" id="privacy-accept" data-i18n="privacy.acceptAll"></button>' +
            '<button type="button" class="privacy-link" id="privacy-customise" data-i18n="privacy.customise"></button>' +
        '</div>';

    document.body.appendChild(banner);
    applyTranslations(banner);

    banner.querySelector("#privacy-accept").addEventListener("click", () => {
        consent.preferences = true;
        consent.work = true;
        consent.community = true;
        persistConsent();
        for (const group of STORAGE_GROUPS) flushGroup(group.id);
        closeBanner();
        toast(t("privacy.savedAll"));
    });

    banner.querySelector("#privacy-essential").addEventListener("click", () => {
        consent.preferences = false;
        consent.work = false;
        consent.community = false;
        persistConsent();
        applyConsent();
        closeBanner();
        toast(t("privacy.savedEssential"));
    });

    banner.querySelector("#privacy-customise").addEventListener("click", () => {
        closeBanner();
        openSettings();
    });

    reserveBannerRoom();
    window.addEventListener("resize", reserveBannerRoom);
    requestAnimationFrame(() => banner.classList.add("show"));
}

/* Give the page back exactly the space the banner occupies, so nothing the
   visitor might want to press is hidden underneath it. */
function reserveBannerRoom() {
    if (!banner) return;
    document.body.classList.add("privacy-banner-up");
    document.body.style.setProperty(
        "--privacy-banner-h", banner.offsetHeight + "px");
}

function closeBanner() {
    if (!banner) return;

    banner.classList.remove("show");
    window.removeEventListener("resize", reserveBannerRoom);
    document.body.classList.remove("privacy-banner-up");
    document.body.style.removeProperty("--privacy-banner-h");

    const node = banner;
    banner = null;
    setTimeout(() => node.remove(), 320);
}

function toast(message) {
    if (typeof showToast === "function") showToast(message);
}

// ---------------------------------------------------------------------
// SETTINGS DIALOG
// ---------------------------------------------------------------------

let settings = null;
let lastFocus = null;

function buildSettings() {
    settings = document.createElement("div");
    settings.className = "mission-modal privacy-modal";
    settings.id = "privacy-modal";
    settings.setAttribute("role", "dialog");
    settings.setAttribute("aria-modal", "true");
    settings.setAttribute("aria-labelledby", "privacy-heading");
    settings.hidden = true;

    const rows = STORAGE_GROUPS.map(group => {
        const keys = group.keys.map(k => "<code>" + k + "</code>").join(" ");
        const control = group.required
            ? '<span class="privacy-always" data-i18n="privacy.always"></span>'
            : '<label class="privacy-switch">' +
                  '<input type="checkbox" data-group="' + group.id + '">' +
                  '<span class="privacy-slider" aria-hidden="true"></span>' +
                  '<span class="sr-only" data-i18n="privacy.group.' + group.id + '"></span>' +
              '</label>';

        return '<div class="privacy-row">' +
                   '<div class="privacy-row-text">' +
                       '<h3 data-i18n="privacy.group.' + group.id + '"></h3>' +
                       '<p data-i18n="privacy.groupDesc.' + group.id + '"></p>' +
                       '<p class="privacy-keys">' + keys + '</p>' +
                   '</div>' +
                   '<div class="privacy-row-control">' + control + '</div>' +
               '</div>';
    }).join("");

    settings.innerHTML =
        '<div class="mission-box privacy-box">' +
            '<div class="mission-header">' +
                '<h2 id="privacy-heading" data-i18n="privacy.title"></h2>' +
                '<button id="privacy-close" class="icon-btn" type="button" data-i18n-aria-label="help.close">✕</button>' +
            '</div>' +

            '<p class="privacy-lead" data-i18n="privacy.lead"></p>' +

            '<ul class="privacy-facts">' +
                '<li data-i18n="privacy.fact1"></li>' +
                '<li data-i18n="privacy.fact2"></li>' +
                '<li data-i18n="privacy.fact3"></li>' +
                '<li data-i18n="privacy.fact4"></li>' +
            '</ul>' +

            '<div class="privacy-rows">' + rows + '</div>' +

            '<div class="privacy-footprint">' +
                '<span data-i18n="privacy.footprint"></span> ' +
                '<strong id="privacy-bytes"></strong>' +
            '</div>' +

            '<div class="privacy-actions">' +
                '<button type="button" class="text-btn" id="privacy-export" data-i18n="privacy.export"></button>' +
                '<button type="button" class="text-btn privacy-danger" id="privacy-erase" data-i18n="privacy.erase"></button>' +
                '<a class="text-btn" href="privacy.html" data-i18n="privacy.readFull"></a>' +
            '</div>' +

            '<button type="button" class="mission-submit" id="privacy-save" data-i18n="privacy.save"></button>' +
        '</div>';

    document.body.appendChild(settings);
    applyTranslations(settings);

    settings.querySelector("#privacy-close").addEventListener("click", closeSettings);
    settings.querySelector("#privacy-save").addEventListener("click", saveSettings);
    settings.querySelector("#privacy-export").addEventListener("click", exportData);

    settings.querySelector("#privacy-erase").addEventListener("click", () => {
        if (window.confirm(t("privacy.eraseConfirm"))) eraseEverything();
    });

    settings.addEventListener("click", (event) => {
        if (event.target === settings) closeSettings();
    });

    settings.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.stopPropagation();
            closeSettings();
            return;
        }
        if (event.key !== "Tab") return;

        // keep focus inside the dialog while it is open
        const focusable = settings.querySelectorAll(
            'button, input, a[href], select, textarea');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
}

function syncSettings() {
    settings.querySelectorAll("input[data-group]").forEach(box => {
        box.checked = consent[box.dataset.group] === true;
    });
    settings.querySelector("#privacy-bytes").textContent =
        t("privacy.bytes", { n: storedByteCount() });
}

function openSettings() {
    // Some entry points (the privacy page's own header button) don't close
    // the banner first — closing it here too means the two can never stack,
    // whichever one the visitor reaches this from.
    if (banner) closeBanner();

    if (!settings) buildSettings();
    lastFocus = document.activeElement;

    syncSettings();
    settings.hidden = false;
    requestAnimationFrame(() => settings.classList.add("open"));
    settings.querySelector("#privacy-close").focus();
}

function closeSettings() {
    if (!settings) return;
    settings.classList.remove("open");
    setTimeout(() => { settings.hidden = true; }, 260);
    if (lastFocus && lastFocus.focus) lastFocus.focus();

    // closing without saving must not count as agreeing to anything
    if (!decided) buildBanner();
}

function saveSettings() {
    const before = { ...consent };

    settings.querySelectorAll("input[data-group]").forEach(box => {
        consent[box.dataset.group] = box.checked;
    });

    persistConsent();

    for (const group of STORAGE_GROUPS) {
        if (group.required) continue;
        if (consent[group.id] && !before[group.id]) flushGroup(group.id);
    }
    applyConsent();

    syncSettings();
    closeSettings();
    toast(t("privacy.saved"));
}

// ---------------------------------------------------------------------
// FOOTER LINK — withdrawal must be as easy as consent, so the way back in
// is a permanent link rather than something buried in a policy page.
// ---------------------------------------------------------------------

function buildPrivacyLink() {
    const mounts = document.querySelectorAll(".privacy-mount");
    if (!mounts.length) return;

    mounts.forEach(mount => {
        mount.innerHTML = "";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "privacy-reopen";
        button.dataset.i18n = "privacy.manage";
        button.addEventListener("click", openSettings);
        mount.appendChild(button);

        const sep = document.createElement("span");
        sep.className = "privacy-sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "·";
        mount.appendChild(sep);

        const link = document.createElement("a");
        link.href = "privacy.html";
        link.dataset.i18n = "privacy.notice";
        mount.appendChild(link);

        applyTranslations(mount);
    });
}

// ---------------------------------------------------------------------
// NOTICE PAGE — the inventory table is generated from STORAGE_GROUPS rather
// than written out by hand, so the published notice cannot drift away from
// what the code actually stores.
// ---------------------------------------------------------------------

function renderInventory() {
    const mount = document.getElementById("privacy-table");
    if (!mount) return;

    const head =
        "<thead><tr>" +
            "<th>" + t("privacy.tableGroup") + "</th>" +
            "<th>" + t("privacy.tableWhat") + "</th>" +
            "<th>" + t("privacy.tableKeys") + "</th>" +
        "</tr></thead>";

    const body = STORAGE_GROUPS.map(group =>
        "<tr>" +
            "<td>" + t("privacy.group." + group.id) +
                (group.required ? "<br><small>" + t("privacy.always") + "</small>" : "") +
            "</td>" +
            "<td>" + t("privacy.groupDesc." + group.id) + "</td>" +
            "<td>" + group.keys.map(k => "<code>" + k + "</code>").join("") + "</td>" +
        "</tr>"
    ).join("");

    mount.innerHTML = head + "<tbody>" + body + "</tbody>";
}

// ---------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------

function initPrivacy() {
    buildPrivacyLink();
    renderInventory();

    const opener = document.getElementById("privacy-open");
    if (opener) opener.addEventListener("click", openSettings);

    if (!decided) buildBanner();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPrivacy);
} else {
    initPrivacy();
}

/* The dialog and banner are built from i18n keys, so a language switch has to
   repaint whatever is currently on screen. */
if (typeof onLocaleChange === "function") {
    onLocaleChange(() => {
        if (banner) applyTranslations(banner);
        if (settings) { applyTranslations(settings); syncSettings(); }
        buildPrivacyLink();
        renderInventory();
    });
}
