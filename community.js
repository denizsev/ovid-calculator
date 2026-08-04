/* =====================================================================
   OVID CALCULATOR — MISSION CONTROL

   Users report bugs, propose features, and get credited when a proposal
   is accepted. The site is static, so there is no server to post to:

     1. Everything is stored locally first, so the flow works instantly
        and offline.
     2. "Send to GitHub" opens a prefilled issue — the real review
        channel, and it needs no token or backend.
     3. The Hall of Fame reads contributors.json from the repo, which is
        updated when a contribution is accepted. That makes it a genuinely
        shared board rather than a fake one.

   XP deliberately rewards ACCEPTED work far more than submitting, so the
   incentive is quality rather than volume.
   ===================================================================== */

const REPO = "denizsev/ovid-calculator";

const STORAGE_PROFILE = "ovid-profile";
const STORAGE_ENTRIES = "ovid-entries";

const XP_SUBMIT = 10;
const XP_ACCEPTED = 100;

const RANKS = [
    { min: 0, key: "rank.rookie", icon: "🌑" },
    { min: 50, key: "rank.crew", icon: "🌘" },
    { min: 150, key: "rank.pilot", icon: "🌗" },
    { min: 400, key: "rank.captain", icon: "🌖" },
    { min: 900, key: "rank.commander", icon: "🌕" },
    { min: 2000, key: "rank.admiral", icon: "⭐" }
];

const BADGES = [
    {
        id: "first-contact",
        key: "badge.firstContact", hintKey: "badge.firstContactHint",
        icon: "📡",
        
        earned: (entries) => entries.length >= 1
    },
    {
        id: "bug-hunter",
        key: "badge.bugHunter", hintKey: "badge.bugHunterHint",
        icon: "🐞",
        
        earned: (entries) => entries.filter(e => e.type === "bug").length >= 3
    },
    {
        id: "inventor",
        key: "badge.inventor", hintKey: "badge.inventorHint",
        icon: "💡",
        
        earned: (entries) => entries.filter(e => e.type === "idea").length >= 3
    },
    {
        id: "persistent",
        key: "badge.persistent", hintKey: "badge.persistentHint",
        icon: "🛰️",
        
        earned: (entries) => new Set(entries.map(e => new Date(e.at).toDateString())).size >= 3
    },
    {
        id: "star-explorer",
        key: "badge.starExplorer", hintKey: "badge.starExplorerHint",
        icon: "⭐",
        
        earned: (entries) => entries.some(e => e.status === "accepted")
    }
];

const TYPE_LABELS = {
    bug: { key: "type.bug", icon: "🐞", issueLabel: "bug" },
    idea: { key: "type.idea", icon: "💡", issueLabel: "enhancement" },
    improve: { key: "type.improve", icon: "⚡", issueLabel: "improvement" }
};

// ---------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------

function loadProfile() {
    try {
        return JSON.parse(storeGet(STORAGE_PROFILE)) || { name: "" };
    } catch (e) {
        return { name: "" };
    }
}

function saveProfile(profile) {
    storeSet(STORAGE_PROFILE, JSON.stringify(profile));
}

function loadEntries() {
    try {
        return JSON.parse(storeGet(STORAGE_ENTRIES)) || [];
    } catch (e) {
        return [];
    }
}

function saveEntries(entries) {
    storeSet(STORAGE_ENTRIES, JSON.stringify(entries));
}

let profile = loadProfile();
let entries = loadEntries();

function totalXp() {
    return entries.reduce(
        (sum, entry) => sum + XP_SUBMIT + (entry.status === "accepted" ? XP_ACCEPTED : 0),
        0
    );
}

function rankFor(xp) {
    let current = RANKS[0];
    let next = null;

    for (let i = 0; i < RANKS.length; i++) {
        if (xp >= RANKS[i].min) {
            current = RANKS[i];
            next = RANKS[i + 1] || null;
        }
    }

    return { current, next };
}

// ---------------------------------------------------------------------
// DOM HELPERS  (textContent only — submissions are untrusted input)
// ---------------------------------------------------------------------

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const cq = id => document.getElementById(id);

// ---------------------------------------------------------------------
// MODAL
// ---------------------------------------------------------------------

const modal = cq("mission-modal");

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

let lastFocused = null;

function openMission() {
    lastFocused = document.activeElement;

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    cq("mission-open").setAttribute("aria-expanded", "true");
    renderAll();

    document.addEventListener("keydown", missionKeys);
    setTimeout(() => cq("mission-name").focus(), 60);
}

function closeMission() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    cq("mission-open").setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", missionKeys);

    // send focus back where it came from, or keyboard users get stranded
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
}

/* Escape closes, and Tab is trapped inside the dialog so keyboard users
   cannot wander onto the calculator behind it. */
function missionKeys(event) {
    if (event.key === "Escape") {
        closeMission();
        return;
    }

    if (event.key !== "Tab") return;

    const items = [...modal.querySelectorAll(FOCUSABLE)]
        .filter(node => node.offsetParent !== null);

    if (!items.length) return;

    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

cq("mission-open").addEventListener("click", openMission);
cq("mission-close").addEventListener("click", closeMission);

modal.addEventListener("click", (event) => {
    if (event.target === modal) closeMission();
});

document.querySelectorAll(".mission-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".mission-tab").forEach(other => {
            other.classList.remove("active");
            other.setAttribute("aria-selected", "false");
        });
        document.querySelectorAll(".mission-pane").forEach(p => p.classList.remove("active"));

        tab.classList.add("active");
        tab.setAttribute("aria-selected", "true");
        cq("mission-" + tab.dataset.mtab).classList.add("active");
    });
});

// ---------------------------------------------------------------------
// SUBMIT FLOW
// ---------------------------------------------------------------------

function validName(name) {
    return /^[\p{L}\p{N} _.-]{3,20}$/u.test(name);
}

function missionToast(message) {
    const box = cq("mission-feedback");
    box.textContent = message;
    box.classList.add("show");
    setTimeout(() => box.classList.remove("show"), 2600);
}

function issueUrl(entry) {
    const meta = TYPE_LABELS[entry.type];

    const body = [
        "**" + t("mission.sentBy") + ":** " + entry.name,
        "**" + t("mission.kind") + ":** " + t(meta.key),
        "",
        entry.detail,
        "",
        "---",
        "_" + t("mission.via") + "_"
    ].join("\n");

    return "https://github.com/" + REPO + "/issues/new" +
        "?title=" + encodeURIComponent("[" + meta.issueLabel + "] " + entry.title) +
        "&body=" + encodeURIComponent(body) +
        "&labels=" + encodeURIComponent(meta.issueLabel);
}

cq("mission-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const name = cq("mission-name").value.trim();
    const type = cq("mission-type").value;
    const title = cq("mission-title").value.trim();
    const detail = cq("mission-detail").value.trim();

    if (!validName(name)) {
        missionToast(t("mission.errName"));
        return;
    }
    if (title.length < 5) {
        missionToast(t("mission.errTitle"));
        return;
    }
    if (detail.length < 20) {
        missionToast(t("mission.errDetail"));
        return;
    }

    profile.name = name;
    saveProfile(profile);

    const entry = {
        id: "e" + Date.now(),
        name,
        type,
        title,
        detail,
        at: Date.now(),
        status: "draft"
    };

    const before = t(rankFor(totalXp()).current.key);

    entries.unshift(entry);
    entries = entries.slice(0, 100);
    saveEntries(entries);

    const after = t(rankFor(totalXp()).current.key);

    cq("mission-title").value = "";
    cq("mission-detail").value = "";

    renderAll();

    if (after !== before) {
        missionToast(t("mission.savedRank", { r: after }));
    } else {
        missionToast(t("mission.saved"));
    }
});

// ---------------------------------------------------------------------
// RENDER: my record
// ---------------------------------------------------------------------

function renderProgress() {
    const xp = totalXp();
    const { current, next } = rankFor(xp);

    cq("rank-icon").textContent = current.icon;
    cq("rank-title").textContent = t(current.key);
    cq("rank-xp").textContent = xp + " XP";

    const bar = cq("rank-bar-fill");

    if (next) {
        const span = next.min - current.min;
        const done = xp - current.min;
        bar.style.width = Math.max(4, Math.min(100, (done / span) * 100)) + "%";
        cq("rank-next").textContent = t("mission.nextRank", { n: next.min - xp, r: t(next.key) });
    } else {
        bar.style.width = "100%";
        cq("rank-next").textContent = t("mission.topRank");
    }
}

function renderBadges() {
    const list = cq("badge-list");
    list.textContent = "";

    BADGES.forEach(badge => {
        const earned = badge.earned(entries);

        const item = el("li", "badge" + (earned ? " earned" : ""));
        item.append(
            el("span", "badge-icon", badge.icon),
            el("span", "badge-name", t(badge.key)),
            el("span", "badge-hint", earned ? t("badge.earned") : t(badge.hintKey))
        );

        list.appendChild(item);
    });
}

const STATUS_LABELS = {
    draft: "mission.statusDraft",
    sent: "mission.statusSent",
    accepted: "mission.statusAccepted"
};

function renderEntries() {
    const list = cq("entry-list");
    list.textContent = "";

    if (!entries.length) {
        list.appendChild(el("li", "mission-empty", t("mission.noEntries")));
        return;
    }

    entries.forEach(entry => {
        const meta = TYPE_LABELS[entry.type];
        const item = el("li", "entry");

        const head = el("div", "entry-head");
        head.append(
            el("span", "entry-icon", meta.icon),
            el("span", "entry-title", entry.title),
            el("span", "entry-status status-" + entry.status, t(STATUS_LABELS[entry.status]))
        );

        const detail = el("p", "entry-detail", entry.detail);

        const actions = el("div", "entry-actions");

        if (entry.status === "draft") {
            const send = el("button", "text-btn", t("mission.sendToGithub"));
            send.type = "button";
            send.addEventListener("click", () => {
                window.open(issueUrl(entry), "_blank", "noopener");
                entry.status = "sent";
                saveEntries(entries);
                renderAll();
            });
            actions.appendChild(send);
        }

        const remove = el("button", "text-btn danger", t("mission.delete"));
        remove.type = "button";
        remove.addEventListener("click", () => {
            if (!confirm(t("mission.confirmDelete"))) return;
            entries = entries.filter(e => e.id !== entry.id);
            saveEntries(entries);
            renderAll();
        });
        actions.appendChild(remove);

        item.append(head, detail, actions);
        list.appendChild(item);
    });
}

// ---------------------------------------------------------------------
// RENDER: hall of fame (from the repo, so it is genuinely shared)
// ---------------------------------------------------------------------

let hallLoaded = false;

/* Deterministic hash: a contributor's star must appear in the same place
   every visit, otherwise it isn't "their" star. */
function hashName(name) {
    let hash = 2166136261;
    for (let i = 0; i < name.length; i++) {
        hash ^= name.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash);
}

/* Stars are placed in the margins around the calculator column, so they
   never sit on top of the keypad. */
function renderStarMap(people) {
    const map = cq("star-map");
    if (!map) return;

    map.textContent = "";

    const eligible = people.filter(p => (p.accepted || 0) > 0);

    eligible.forEach((person, index) => {
        const hash = hashName(person.name);
        const onRight = index % 2 === 1;

        // keep clear of the centre column where the calculator lives
        const side = onRight ? 72 + (hash % 22) : 4 + (hash % 22);
        const band = eligible.length > 1 ? index / (eligible.length - 1 || 1) : 0.35;
        const top = 12 + band * 64 + ((hash >> 5) % 9);

        const star = document.createElement("button");
        star.type = "button";
        star.className = "contrib-star" + (onRight ? " right" : "");
        star.style.left = side + "%";
        star.style.top = Math.min(88, top) + "%";
        star.style.setProperty("--star-size", (6 + (hash % 4)) + "px");
        star.style.setProperty("--star-delay", ((hash % 40) / 10) + "s");
        star.setAttribute(
            "aria-label",
            t("badge.starLabel", { name: person.name, n: person.accepted || 0 })
        );

        star.append(el("span", "core"), el("span", "label", person.name));

        star.addEventListener("click", () => {
            star.classList.add("revealed");
            setTimeout(() => star.classList.remove("revealed"), 2600);
        });

        map.appendChild(star);
    });

    // the map sits behind the UI, so only expose it to AT when populated
    map.setAttribute("aria-hidden", eligible.length ? "false" : "true");
}

async function renderHall() {
    if (hallLoaded) return;

    const list = cq("hall-list");
    list.textContent = "";
    list.appendChild(el("li", "mission-empty", t("mission.loading")));

    let data;
    try {
        const response = await fetch("contributors.json", { cache: "no-cache" });
        if (!response.ok) throw new Error("fetch failed");
        data = await response.json();
    } catch (e) {
        list.textContent = "";
        list.appendChild(el("li", "mission-empty", t("mission.hallFailed")));
        return;
    }

    hallLoaded = true;
    list.textContent = "";

    const people = (data.contributors || [])
        .slice()
        .sort((a, b) => (b.xp || 0) - (a.xp || 0));

    renderStarMap(people);

    if (!people.length) {
        list.appendChild(el("li", "mission-empty", t("mission.hallEmpty")));
        return;
    }

    people.forEach((person, index) => {
        const rank = rankFor(person.xp || 0).current;
        const item = el("li", "hall-row" + (index < 3 ? " top" : ""));

        const place = el("span", "hall-place", String(index + 1));

        const who = el("div", "hall-who");
        who.append(
            el("span", "hall-name", person.name),
            el("span", "hall-rank", rank.icon + " " + t(rank.key))
        );

        const stats = el("div", "hall-stats");
        stats.append(
            el("span", "hall-xp", (person.xp || 0) + " XP"),
            el("span", "hall-accepted", (person.accepted || 0) + " " + t("mission.accepted"))
        );

        item.append(place, who, stats);

        if (person.highlights && person.highlights.length) {
            const tags = el("div", "hall-tags");
            person.highlights.forEach(h => tags.appendChild(el("span", "hall-tag", h)));
            item.appendChild(tags);
        }

        list.appendChild(item);
    });

    if (data.updated) {
        cq("hall-updated").textContent = t("mission.updated", { d: data.updated });
    }
}

// ---------------------------------------------------------------------

/* The hint carries inline <code>, so it is built rather than translated
   as a flat string. */
function renderHallHint() {
    const box = cq("hall-hint");
    if (!box) return;

    box.textContent = "";
    const parts = t("mission.hallHint").split(/\{[ab]\}/);
    const xp = [XP_SUBMIT + " XP", XP_ACCEPTED + " XP"];

    parts.forEach((chunk, i) => {
        box.appendChild(document.createTextNode(chunk));
        if (i < parts.length - 1) {
            const strong = document.createElement("strong");
            strong.textContent = xp[i];
            box.appendChild(strong);
        }
    });
}

function renderAll() {
    cq("mission-name").value = profile.name || "";
    renderHallHint();
    renderProgress();
    renderBadges();
    renderEntries();
    renderHall();
}

// ---------------------------------------------------------------------
// HELP — the feature set is invisible otherwise, so it gets its own guide
// ---------------------------------------------------------------------

const helpModal = cq("help-modal");
let helpLastFocused = null;

function openHelp() {
    helpLastFocused = document.activeElement;
    helpModal.classList.add("open");
    helpModal.setAttribute("aria-hidden", "false");
    cq("help-open").setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", helpKeys);
    setTimeout(() => cq("help-close").focus(), 60);
}

function closeHelp() {
    helpModal.classList.remove("open");
    helpModal.setAttribute("aria-hidden", "true");
    cq("help-open").setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", helpKeys);
    if (helpLastFocused && document.contains(helpLastFocused)) helpLastFocused.focus();
}

function helpKeys(event) {
    if (event.key === "Escape") {
        closeHelp();
        return;
    }

    if (event.key !== "Tab") return;

    const items = [...helpModal.querySelectorAll(FOCUSABLE)]
        .filter(node => node.offsetParent !== null);
    if (!items.length) return;

    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

cq("help-open").addEventListener("click", openHelp);
cq("help-close").addEventListener("click", closeHelp);
helpModal.addEventListener("click", (event) => {
    if (event.target === helpModal) closeHelp();
});

/* First-time visitors get pointed at the guide once, and only once. */
if (!storeGet("ovid-seen-help")) {
    storeSet("ovid-seen-help", "1");
    setTimeout(() => cq("help-open").classList.add("nudge"), 1200);
    cq("help-open").addEventListener("click", () => cq("help-open").classList.remove("nudge"), { once: true });
}

buildLanguagePicker("lang-mount");

/* Everything the Mission Control draws itself has to be redrawn on a
   language switch; the declarative markup is handled by i18n.js. */
onLocaleChange(() => {
    hallLoaded = false;
    if (modal.classList.contains("open")) renderAll();
    else renderHallHint();
});

/* The sky should already carry the contributors on first paint, not only
   once someone opens the Hall of Fame. */
(async function bootStarMap() {
    try {
        const response = await fetch("contributors.json", { cache: "no-cache" });
        if (!response.ok) return;

        const data = await response.json();
        const people = (data.contributors || [])
            .slice()
            .sort((a, b) => (b.xp || 0) - (a.xp || 0));

        renderStarMap(people);
    } catch (e) {
        /* offline first run: the sky simply stays empty */
    }
})();
