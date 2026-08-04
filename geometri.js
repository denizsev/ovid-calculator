/* =====================================================================
   OVID — ANALYTIC GEOMETRY

   The interaction model is the one every graphing tool in this category
   shares: a list of objects on one side, a plane on the other, linked so
   that editing either updates the other. The implementation, the maths and
   the drawing here are our own, and reuse the calculator's engine — which
   is why "sin(x)±0.1" or "2π/x" work without a second parser.
   ===================================================================== */

/* Graphing is done in radians by convention: in degrees, sin(x) over a
   window of ±18 is a nearly flat line and every trig plot looks broken.
   The calculator's own DEG/RAD preference is left untouched. */
angleMode = "RAD";

const g = id => document.getElementById(id);

const canvas = g("plane");
const ctx = canvas.getContext("2d");
const listEl = g("obj-list");
const inputEl = g("obj-input");
const emptyEl = g("obj-empty");
const readoutEl = g("readout");

const PALETTE = ["#9fe7ff", "#f8a45f", "#8fe3b0", "#c6a6ff", "#ff9fb0", "#ffe08a"];

let objects = [];
let nextId = 1;
let colourCursor = 0;

/* View is stored in world units: the centre of the plane and how many
   world units one CSS pixel covers. Everything else derives from these. */
let view = { cx: 0, cy: 0, scale: 0.05 };

let dpr = 1;
let W = 0;
let H = 0;

// =====================================================================
// COORDINATES
// =====================================================================

const toScreenX = wx => (wx - view.cx) / view.scale + W / 2;
const toScreenY = wy => H / 2 - (wy - view.cy) / view.scale;
const toWorldX = sx => (sx - W / 2) * view.scale + view.cx;
const toWorldY = sy => (H / 2 - sy) * view.scale + view.cy;

function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();

    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    draw();
}

// =====================================================================
// PARSING — each line the user types becomes one object
// =====================================================================

/* Deliberately small and explicit rather than clever: a point, a circle,
   a vertical line, or a function of x. Anything else is reported as such
   instead of being silently ignored. */
function parseObject(text) {
    const raw = text.trim();
    if (!raw) return null;

    const body = raw.replace(/\s+/g, "");

    // (a, b) — a point
    const point = body.match(/^\(([^,]+),([^)]+)\)$/);
    if (point) {
        const x = evalScalar(point[1]);
        const y = evalScalar(point[2]);
        if (x === null || y === null) throw new Error(t("geo.errPoint"));
        return { kind: "point", x, y };
    }

    // (x-a)^2+(y-b)^2=r^2 — a circle, in the two forms people actually type
    const circle = body.match(/^\(?x([+-][^)]+)?\)?\^2\+\(?y([+-][^)]+)?\)?\^2=(.+)$/);
    if (circle) {
        const shiftX = circle[1] ? evalScalar(circle[1]) : 0;
        const shiftY = circle[2] ? evalScalar(circle[2]) : 0;
        const rhs = evalScalar(circle[3]);
        if (rhs === null || rhs < 0) throw new Error(t("geo.errRadius"));
        // (x + s)^2 means the centre sits at -s
        return { kind: "circle", cx: -(shiftX || 0), cy: -(shiftY || 0), r: Math.sqrt(rhs) };
    }

    // x = c — the one line a function of x cannot express
    const vertical = body.match(/^x=(.+)$/);
    if (vertical) {
        const at = evalScalar(vertical[1]);
        if (at === null) throw new Error(t("geo.errVertical"));
        return { kind: "vline", at };
    }

    // y = f(x) / f(x) = ... / a bare expression
    let expr = body;
    const named = body.match(/^(?:y|f\(x\)|g\(x\)|h\(x\))=(.+)$/);
    if (named) expr = named[1];

    if (!/x/.test(expr)) {
        // a constant is still a valid horizontal line
        const value = evalScalar(expr);
        if (value === null) throw new Error(t("geo.errExpression"));
        return { kind: "fn", expr, constant: value };
    }

    // prove it evaluates before accepting it
    if (sampleAt(expr, 1) === null && sampleAt(expr, 0.5) === null) {
        throw new Error(t("geo.errExpression"));
    }

    return { kind: "fn", expr };
}

function evalScalar(text) {
    try {
        clearVariables();
        const q = evaluate(text);
        return q && isFinite(q.v) ? q.v : null;
    } catch (e) {
        return null;
    }
}

function sampleAt(expr, x) {
    try {
        setVariable("x", x);
        const q = evaluate(expr);
        return q && isFinite(q.v) ? q.v : null;
    } catch (e) {
        return null;
    }
}

// =====================================================================
// DRAWING
// =====================================================================

/* Grid spacing that lands on 1/2/5×10^n, so labels stay readable at any zoom */
function niceSpacing(targetPx) {
    const rough = targetPx * view.scale;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const n = rough / magnitude;
    return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * magnitude;
}

function formatTick(value, step) {
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    const text = value.toFixed(Math.min(decimals, 6));

    // strip trailing zeros only after a decimal point — otherwise 10 became "1"
    if (!text.includes(".")) return text;

    return text.replace(/0+$/, "").replace(/\.$/, "") || "0";
}

function drawGrid() {
    const major = niceSpacing(84);
    const minor = major / 5;

    const left = toWorldX(0);
    const right = toWorldX(W);
    const bottom = toWorldY(H);
    const top = toWorldY(0);

    ctx.lineWidth = 1;

    // minor
    ctx.strokeStyle = "rgba(159, 231, 255, 0.055)";
    ctx.beginPath();
    for (let x = Math.ceil(left / minor) * minor; x < right; x += minor) {
        const sx = Math.round(toScreenX(x)) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
    }
    for (let y = Math.ceil(bottom / minor) * minor; y < top; y += minor) {
        const sy = Math.round(toScreenY(y)) + 0.5;
        ctx.moveTo(0, sy); ctx.lineTo(W, sy);
    }
    ctx.stroke();

    // major
    ctx.strokeStyle = "rgba(159, 231, 255, 0.13)";
    ctx.beginPath();
    for (let x = Math.ceil(left / major) * major; x < right; x += major) {
        const sx = Math.round(toScreenX(x)) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
    }
    for (let y = Math.ceil(bottom / major) * major; y < top; y += major) {
        const sy = Math.round(toScreenY(y)) + 0.5;
        ctx.moveTo(0, sy); ctx.lineTo(W, sy);
    }
    ctx.stroke();

    // axes
    const ax = Math.round(toScreenX(0)) + 0.5;
    const ay = Math.round(toScreenY(0)) + 0.5;
    ctx.strokeStyle = "rgba(210, 238, 255, 0.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (ay > -1 && ay < H + 1) { ctx.moveTo(0, ay); ctx.lineTo(W, ay); }
    if (ax > -1 && ax < W + 1) { ctx.moveTo(ax, 0); ctx.lineTo(ax, H); }
    ctx.stroke();

    // labels, pinned to the edge when the origin is off-screen
    ctx.fillStyle = "rgba(210, 238, 255, 0.5)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const labelY = Math.min(Math.max(ay + 4, 4), H - 16);
    for (let x = Math.ceil(left / major) * major; x < right; x += major) {
        if (Math.abs(x) < major / 1e6) continue;
        ctx.fillText(formatTick(x, major), toScreenX(x), labelY);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const labelX = Math.min(Math.max(ax - 6, 30), W - 4);
    for (let y = Math.ceil(bottom / major) * major; y < top; y += major) {
        if (Math.abs(y) < major / 1e6) continue;
        ctx.fillText(formatTick(y, major), labelX, toScreenY(y));
    }

    ctx.textAlign = "left";
    ctx.fillText("0", Math.min(Math.max(ax + 5, 4), W - 12), Math.min(Math.max(ay + 10, 10), H - 6));
}

function drawFunction(obj) {
    ctx.strokeStyle = obj.colour;
    ctx.lineWidth = 2;
    ctx.beginPath();

    // one sample per pixel; a jump larger than the viewport is a break,
    // not a line, so asymptotes are not joined up across the screen
    const jumpLimit = H * 1.5;
    let drawing = false;
    let prevY = null;

    for (let px = 0; px <= W; px++) {
        const wx = toWorldX(px);
        const wy = obj.constant !== undefined ? obj.constant : sampleAt(obj.expr, wx);

        if (wy === null || !isFinite(wy)) { drawing = false; prevY = null; continue; }

        const sy = toScreenY(wy);

        if (drawing && prevY !== null && Math.abs(sy - prevY) > jumpLimit) {
            drawing = false;
        }

        if (!drawing) { ctx.moveTo(px, sy); drawing = true; }
        else ctx.lineTo(px, sy);

        prevY = sy;
    }

    ctx.stroke();
}

function drawPoint(obj) {
    const sx = toScreenX(obj.x);
    const sy = toScreenY(obj.y);

    ctx.fillStyle = obj.colour;
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(5, 7, 13, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = obj.colour;
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`(${formatTick(obj.x, view.scale)}, ${formatTick(obj.y, view.scale)})`, sx + 9, sy - 6);
}

function drawCircle(obj) {
    ctx.strokeStyle = obj.colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(toScreenX(obj.cx), toScreenY(obj.cy), obj.r / view.scale, 0, Math.PI * 2);
    ctx.stroke();
}

function drawVLine(obj) {
    const sx = toScreenX(obj.at);
    ctx.strokeStyle = obj.colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, H);
    ctx.stroke();
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    drawGrid();

    objects.forEach(obj => {
        if (!obj.visible) return;
        try {
            if (obj.kind === "fn") drawFunction(obj);
            else if (obj.kind === "point") drawPoint(obj);
            else if (obj.kind === "circle") drawCircle(obj);
            else if (obj.kind === "vline") drawVLine(obj);
        } catch (e) {
            /* one bad object must not blank the whole plane */
        }
    });
}

// =====================================================================
// OBJECT LIST
// =====================================================================

function renderList() {
    listEl.textContent = "";
    emptyEl.hidden = objects.length > 0;

    objects.forEach(obj => {
        const li = document.createElement("li");
        li.className = "obj" + (obj.visible ? "" : " off");

        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "obj-swatch";
        swatch.style.setProperty("--c", obj.colour);
        swatch.title = obj.visible ? t("geo.hide") : t("geo.show");
        swatch.setAttribute("aria-label", t(obj.visible ? "geo.hideLabel" : "geo.showLabel", { label: obj.label }));
        swatch.addEventListener("click", () => {
            obj.visible = !obj.visible;
            renderList();
            draw();
        });

        const label = document.createElement("span");
        label.className = "obj-label";
        label.textContent = obj.label;

        const kind = document.createElement("span");
        kind.className = "obj-kind";
        kind.textContent = t({ fn: "geo.kindFn", point: "geo.kindPoint", circle: "geo.kindCircle", vline: "geo.kindLine" }[obj.kind]);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "obj-remove";
        remove.textContent = "✕";
        remove.title = t("mission.delete");
        remove.setAttribute("aria-label", t("geo.deleteLabel", { label: obj.label }));
        remove.addEventListener("click", () => {
            objects = objects.filter(o => o.id !== obj.id);
            renderList();
            draw();
        });

        li.append(swatch, label, kind, remove);
        listEl.appendChild(li);
    });
}

function addObject(text) {
    let parsed;
    try {
        parsed = parseObject(text);
    } catch (e) {
        showError(e.message || t("geo.errExpression"));
        return false;
    }

    if (!parsed) return false;

    parsed.id = nextId++;
    parsed.label = text.trim();
    parsed.visible = true;
    parsed.colour = PALETTE[colourCursor++ % PALETTE.length];

    objects.push(parsed);
    renderList();
    draw();
    return true;
}

let errorTimer;
function showError(message) {
    const box = g("obj-error");
    box.textContent = message;
    box.classList.add("show");
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => box.classList.remove("show"), 3200);
}

g("obj-form").addEventListener("submit", event => {
    event.preventDefault();
    if (addObject(inputEl.value)) inputEl.value = "";
});

document.querySelectorAll(".sample").forEach(btn => {
    btn.addEventListener("click", () => {
        inputEl.value = btn.dataset.expr;
        inputEl.focus();
    });
});

g("obj-clear").addEventListener("click", () => {
    if (!objects.length) return;
    if (!confirm(t("geo.confirmClear"))) return;
    objects = [];
    renderList();
    draw();
});

// =====================================================================
// PAN / ZOOM / READOUT
// =====================================================================

let dragging = false;
let dragFrom = null;

canvas.addEventListener("pointerdown", event => {
    dragging = true;
    dragFrom = { x: event.clientX, y: event.clientY, cx: view.cx, cy: view.cy };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("grabbing");
});

canvas.addEventListener("pointermove", event => {
    const rect = canvas.getBoundingClientRect();
    const wx = toWorldX(event.clientX - rect.left);
    const wy = toWorldY(event.clientY - rect.top);
    readoutEl.textContent = `x ${formatTick(wx, view.scale)}   y ${formatTick(wy, view.scale)}`;

    if (!dragging || !dragFrom) return;

    view.cx = dragFrom.cx - (event.clientX - dragFrom.x) * view.scale;
    view.cy = dragFrom.cy + (event.clientY - dragFrom.y) * view.scale;
    draw();
});

function endDrag(event) {
    dragging = false;
    dragFrom = null;
    canvas.classList.remove("grabbing");
    if (event && event.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }
}

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("pointerleave", () => { readoutEl.textContent = ""; });

/* Zoom about the cursor, so the point under the pointer stays put */
function zoomAt(sx, sy, factor) {
    const wx = toWorldX(sx);
    const wy = toWorldY(sy);

    view.scale = Math.min(1e6, Math.max(1e-9, view.scale * factor));
    view.cx = wx - (sx - W / 2) * view.scale;
    view.cy = wy + (sy - H / 2) * view.scale;

    draw();
}

canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(event.deltaY * 0.0012));
}, { passive: false });

g("zoom-in").addEventListener("click", () => zoomAt(W / 2, H / 2, 1 / 1.4));
g("zoom-out").addEventListener("click", () => zoomAt(W / 2, H / 2, 1.4));

g("zoom-reset").addEventListener("click", () => {
    view = { cx: 0, cy: 0, scale: 0.05 };
    draw();
});

// keyboard access to the plane, since drag and wheel are pointer-only
canvas.addEventListener("keydown", event => {
    const stepPx = event.shiftKey ? 120 : 40;
    const moves = {
        ArrowLeft: [-stepPx, 0], ArrowRight: [stepPx, 0],
        ArrowUp: [0, -stepPx], ArrowDown: [0, stepPx]
    };

    if (moves[event.key]) {
        event.preventDefault();
        view.cx += moves[event.key][0] * view.scale;
        view.cy -= moves[event.key][1] * view.scale;
        draw();
        return;
    }

    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAt(W / 2, H / 2, 1 / 1.4); }
    if (event.key === "-") { event.preventDefault(); zoomAt(W / 2, H / 2, 1.4); }
});

// =====================================================================
// BOOT
// =====================================================================

const ro = new ResizeObserver(resize);
ro.observe(canvas);

window.addEventListener("resize", resize);

resize();

/* The hint carries inline <code>, so it is assembled rather than injected. */
function renderGeoHint() {
    const box = g("obj-hint");
    if (!box) return;

    box.textContent = "";
    const parts = t("geo.hint").split(/\{[ab]\}/);
    const fills = [
        () => { const s = document.createElement("strong"); s.textContent = t("geo.sameEngine"); return s; },
        () => {
            const span = document.createElement("span");
            ["sin", "ln", "π", "^"].forEach((name, i) => {
                if (i) span.appendChild(document.createTextNode(", "));
                const code = document.createElement("code");
                code.textContent = name;
                span.appendChild(code);
            });
            return span;
        }
    ];

    // the sentence orders the two slots differently per language
    const order = t("geo.hint").indexOf("{b}") < t("geo.hint").indexOf("{a}") ? [0, 1] : [1, 0];

    parts.forEach((chunk, i) => {
        box.appendChild(document.createTextNode(chunk));
        if (i < parts.length - 1) box.appendChild(fills[order[i]]());
    });
}

renderGeoHint();

onLocaleChange(() => {
    renderGeoHint();
    renderList();
    draw();
});

// something on screen beats an empty plane and a blinking cursor
["y=sin(x)", "y=x^2/4-3", "(2,3)"].forEach(addObject);
