/* =====================================================================
   OVID CALCULATOR — GÖREV MERKEZİ (Mission Control)

   Users report bugs, propose features, and get credited when a proposal
   is accepted. The site is static, so there is no server to post to:

     1. Everything is stored locally first, so the flow works instantly
        and offline.
     2. "GitHub'a gönder" opens a prefilled issue — the real review
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
    { min: 0, title: "Çaylak", icon: "🌑" },
    { min: 50, title: "Mürettebat", icon: "🌘" },
    { min: 150, title: "Pilot", icon: "🌗" },
    { min: 400, title: "Kaptan", icon: "🌖" },
    { min: 900, title: "Komutan", icon: "🌕" },
    { min: 2000, title: "Yıldız Amirali", icon: "⭐" }
];

const BADGES = [
    {
        id: "first-contact",
        name: "İlk Temas",
        icon: "📡",
        hint: "İlk katkını gönder",
        earned: (entries) => entries.length >= 1
    },
    {
        id: "bug-hunter",
        name: "Hata Avcısı",
        icon: "🐞",
        hint: "3 hata bildir",
        earned: (entries) => entries.filter(e => e.type === "bug").length >= 3
    },
    {
        id: "inventor",
        name: "Mucit",
        icon: "💡",
        hint: "3 öneri gönder",
        earned: (entries) => entries.filter(e => e.type === "idea").length >= 3
    },
    {
        id: "persistent",
        name: "Sadık Mürettebat",
        icon: "🛰️",
        hint: "3 ayrı günde katkı ver",
        earned: (entries) => new Set(entries.map(e => new Date(e.at).toDateString())).size >= 3
    },
    {
        id: "star-explorer",
        name: "Yıldız Kâşifi",
        icon: "⭐",
        hint: "Bir katkın kabul edilsin",
        earned: (entries) => entries.some(e => e.status === "accepted")
    }
];

const TYPE_LABELS = {
    bug: { label: "Hata bildirimi", icon: "🐞", issueLabel: "bug" },
    idea: { label: "Yeni özellik önerisi", icon: "💡", issueLabel: "enhancement" },
    improve: { label: "İyileştirme önerisi", icon: "⚡", issueLabel: "improvement" }
};

// ---------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------

function loadProfile() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_PROFILE)) || { name: "" };
    } catch (e) {
        return { name: "" };
    }
}

function saveProfile(profile) {
    localStorage.setItem(STORAGE_PROFILE, JSON.stringify(profile));
}

function loadEntries() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_ENTRIES)) || [];
    } catch (e) {
        return [];
    }
}

function saveEntries(entries) {
    localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(entries));
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

function openMission() {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    cq("mission-open").setAttribute("aria-expanded", "true");
    renderAll();
    document.addEventListener("keydown", escapeMission);
}

function closeMission() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    cq("mission-open").setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", escapeMission);
}

function escapeMission(event) {
    if (event.key === "Escape") closeMission();
}

cq("mission-open").addEventListener("click", openMission);
cq("mission-close").addEventListener("click", closeMission);

modal.addEventListener("click", (event) => {
    if (event.target === modal) closeMission();
});

document.querySelectorAll(".mission-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".mission-tab").forEach(t => {
            t.classList.remove("active");
            t.setAttribute("aria-selected", "false");
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
        "**Gönderen:** " + entry.name,
        "**Tür:** " + meta.label,
        "",
        entry.detail,
        "",
        "---",
        "_Ovid Calculator Görev Merkezi üzerinden gönderildi._"
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
        missionToast("Kullanıcı adı 3–20 karakter olmalı.");
        return;
    }
    if (title.length < 5) {
        missionToast("Başlık en az 5 karakter olmalı.");
        return;
    }
    if (detail.length < 20) {
        missionToast("Biraz daha ayrıntı yaz — en az 20 karakter.");
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

    const before = rankFor(totalXp()).current.title;

    entries.unshift(entry);
    entries = entries.slice(0, 100);
    saveEntries(entries);

    const after = rankFor(totalXp()).current.title;

    cq("mission-title").value = "";
    cq("mission-detail").value = "";

    renderAll();

    if (after !== before) {
        missionToast("Kaydedildi. Yeni rütbe: " + after + "! 🎉");
    } else {
        missionToast("Kaydedildi. Aşağıdan GitHub'a gönderebilirsin.");
    }
});

// ---------------------------------------------------------------------
// RENDER: my record
// ---------------------------------------------------------------------

function renderProgress() {
    const xp = totalXp();
    const { current, next } = rankFor(xp);

    cq("rank-icon").textContent = current.icon;
    cq("rank-title").textContent = current.title;
    cq("rank-xp").textContent = xp + " XP";

    const bar = cq("rank-bar-fill");

    if (next) {
        const span = next.min - current.min;
        const done = xp - current.min;
        bar.style.width = Math.max(4, Math.min(100, (done / span) * 100)) + "%";
        cq("rank-next").textContent = (next.min - xp) + " XP sonra: " + next.title;
    } else {
        bar.style.width = "100%";
        cq("rank-next").textContent = "En yüksek rütbedesin.";
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
            el("span", "badge-name", badge.name),
            el("span", "badge-hint", earned ? "Kazanıldı" : badge.hint)
        );

        list.appendChild(item);
    });
}

const STATUS_LABELS = {
    draft: "Gönderilmedi",
    sent: "GitHub'a gönderildi",
    accepted: "Kabul edildi"
};

function renderEntries() {
    const list = cq("entry-list");
    list.textContent = "";

    if (!entries.length) {
        list.appendChild(el("li", "mission-empty", "Henüz katkın yok. İlk fikrini gönder!"));
        return;
    }

    entries.forEach(entry => {
        const meta = TYPE_LABELS[entry.type];
        const item = el("li", "entry");

        const head = el("div", "entry-head");
        head.append(
            el("span", "entry-icon", meta.icon),
            el("span", "entry-title", entry.title),
            el("span", "entry-status status-" + entry.status, STATUS_LABELS[entry.status])
        );

        const detail = el("p", "entry-detail", entry.detail);

        const actions = el("div", "entry-actions");

        if (entry.status === "draft") {
            const send = el("button", "text-btn", "GitHub'a gönder ↗");
            send.type = "button";
            send.addEventListener("click", () => {
                window.open(issueUrl(entry), "_blank", "noopener");
                entry.status = "sent";
                saveEntries(entries);
                renderAll();
            });
            actions.appendChild(send);
        }

        const remove = el("button", "text-btn danger", "Sil");
        remove.type = "button";
        remove.addEventListener("click", () => {
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

async function renderHall() {
    if (hallLoaded) return;

    const list = cq("hall-list");
    list.textContent = "";
    list.appendChild(el("li", "mission-empty", "Yükleniyor…"));

    let data;
    try {
        const response = await fetch("contributors.json", { cache: "no-cache" });
        if (!response.ok) throw new Error("fetch failed");
        data = await response.json();
    } catch (e) {
        list.textContent = "";
        list.appendChild(el("li", "mission-empty", "Onur Panosu şu an yüklenemedi."));
        return;
    }

    hallLoaded = true;
    list.textContent = "";

    const people = (data.contributors || [])
        .slice()
        .sort((a, b) => (b.xp || 0) - (a.xp || 0));

    if (!people.length) {
        list.appendChild(el("li", "mission-empty", "Pano henüz boş — ilk sen ol!"));
        return;
    }

    people.forEach((person, index) => {
        const rank = rankFor(person.xp || 0).current;
        const item = el("li", "hall-row" + (index < 3 ? " top" : ""));

        const place = el("span", "hall-place", String(index + 1));

        const who = el("div", "hall-who");
        who.append(
            el("span", "hall-name", person.name),
            el("span", "hall-rank", rank.icon + " " + rank.title)
        );

        const stats = el("div", "hall-stats");
        stats.append(
            el("span", "hall-xp", (person.xp || 0) + " XP"),
            el("span", "hall-accepted", (person.accepted || 0) + " kabul")
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
        cq("hall-updated").textContent = "Son güncelleme: " + data.updated;
    }
}

// ---------------------------------------------------------------------

function renderAll() {
    cq("mission-name").value = profile.name || "";
    renderProgress();
    renderBadges();
    renderEntries();
    renderHall();
}
