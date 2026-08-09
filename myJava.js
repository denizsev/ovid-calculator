/* =====================================================================
   OVID CALCULATOR — UI

   The expression engine lives in engine.js; this file wires it to the
   keypad, display, panels and keyboard.
   ===================================================================== */

const $ = id => document.getElementById(id);

const exprLine = $("expr-line");
const resultLine = $("result-line");
const a11yResult = $("a11y-result");
const memoryIndicator = $("memory-indicator");
const angleIndicator = $("angle-indicator");
const sidePanel = $("side-panel");
const panelToggle = $("panel-toggle");
const historyList = $("history-list");
const toastEl = $("toast");

let expression = "0";
let lastResult = null;
let soundOn = storeGet("ovid-sound") !== "off";
let stepMode = storeGet("ovid-step") === "on";
let secondMode = false;
let memory = Number(storeGet("ovid-memory")) || 0;
let history = JSON.parse(storeGet("ovid-history") || "[]");

const undoStack = [];
const redoStack = [];

function prettify(expr) {
    return expr
        .replace(/\*/g, " × ")
        .replace(/\//g, " ÷ ")
        .replace(/(?<=[\d)π!])-/g, " − ")
        .replace(/\+/g, " + ")
        .replace(/mod/g, " mod ")
        .replace(/\s+/g, " ")
        .trim();
}

/* A long result used to be cut off with an ellipsis, so the user could not
   read their own answer. Shrink the type instead until it fits. */
function fitResult() {
    const length = resultLine.textContent.length;
    resultLine.classList.toggle("shrink-1", length > 12 && length <= 18);
    resultLine.classList.toggle("shrink-2", length > 18 && length <= 26);
    resultLine.classList.toggle("shrink-3", length > 26);
}

/* Renders the expression as chips so any number in it can be grabbed and
   turned into a slider. Falls back to plain text while the expression is
   still half-typed and cannot be tokenised. */
function renderExpression() {
    let tokens;
    try {
        tokens = tokenize(expression);
    } catch (e) {
        exprLine.textContent = prettify(expression);
        return;
    }

    exprLine.textContent = "";

    tokens.forEach(token => {
        // A typed digit run (has numStart/numEnd) can be dragged into a
        // slider. π, e and geometry variables have no source position to
        // rewrite — sliding "π" would not mean anything — so they render
        // as plain, non-interactive text using their symbol for display.
        if (token.type === "number" && token.symbol) {
            const span = document.createElement("span");
            let label = token.symbol;
            if (token.unit) label += " " + token.unit;
            span.textContent = label;
            exprLine.appendChild(span);
            return;
        }

        if (token.type === "number") {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "num-chip";
            chip.dataset.start = token.numStart;
            chip.dataset.end = token.numEnd;

            let label = token.raw;
            if (token.uncertRaw) label += "±" + token.uncertRaw;
            if (token.unit) label += " " + token.unit;

            chip.textContent = label;
            chip.title = t("key.copyResult");
            chip.setAttribute("aria-label", label);

            chip.addEventListener("click", (event) => {
                event.stopPropagation();
                openSlider(Number(chip.dataset.start), Number(chip.dataset.end));
            });

            exprLine.appendChild(chip);
            return;
        }

        const span = document.createElement("span");

        if (token.type === "operator") {
            span.textContent = " " + (OP_SYMBOLS[token.value] || token.value) + " ";
        } else if (token.type === "function") {
            span.textContent = token.value;
        } else {
            span.textContent = token.value;
        }

        exprLine.appendChild(span);
    });
}

// live preview — the answer appears before "=" is pressed
function refreshPreview() {
    try {
        const value = evaluate(expression);
        if (value && !Number.isNaN(value.v)) {
            resultLine.textContent = formatQuantity(value);
        }
    } catch (e) {
        /* incomplete expression: keep the last preview rather than flicker */
    }

    resultLine.classList.add("preview");
    fitResult();
}

function updateDisplay() {
    renderExpression();
    refreshPreview();
}

// =====================================================================
// "NE OLURDU?" — turn a number in the expression into a live slider
// =====================================================================

let sliderTarget = null; // { start, end, original }

function niceStep(span) {
    const raw = span / 100;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const normalised = raw / magnitude;
    const rounded = normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1;
    return rounded * magnitude;
}

function openSlider(start, end) {
    const text = expression.slice(start, end);
    const value = parseFloat(text);
    if (!isFinite(value)) return;

    // a range that keeps the current value in the middle and stays intuitive
    const reach = Math.abs(value) > 0 ? Math.abs(value) : 10;
    const min = value - reach;
    const max = value + reach;
    const step = niceStep(max - min);

    sliderTarget = { start, end, original: text };

    const range = $("whatif-range");
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(value);

    $("whatif-min").textContent = formatNumber(min);
    $("whatif-max").textContent = formatNumber(max);
    $("whatif-label").textContent = text;
    $("whatif").hidden = false;

    highlightSliderChip();
    playTick(1180);
}

function highlightSliderChip() {
    document.querySelectorAll(".num-chip").forEach(chip => {
        chip.classList.toggle(
            "active",
            sliderTarget !== null && Number(chip.dataset.start) === sliderTarget.start
        );
    });
}

function closeSlider() {
    sliderTarget = null;
    $("whatif").hidden = true;
    highlightSliderChip();
}

$("whatif-close").addEventListener("click", closeSlider);

$("whatif-range").addEventListener("input", (event) => {
    if (!sliderTarget) return;

    const text = String(Number(Number(event.target.value).toPrecision(12)));

    expression =
        expression.slice(0, sliderTarget.start) +
        text +
        expression.slice(sliderTarget.end);

    // the replacement changes the length, so the target must follow it
    sliderTarget.end = sliderTarget.start + text.length;

    $("whatif-label").textContent = text;

    renderExpression();
    refreshPreview();
    highlightSliderChip();
});

function showMessage(message) {
    exprLine.textContent = message;
    resultLine.textContent = "0";
    resultLine.classList.remove("preview");
    announce(message);
}

function announce(text) {
    a11yResult.textContent = text;
}

// =====================================================================
// UNDO / REDO
// =====================================================================

function pushUndo() {
    // every editing action goes through here, and any of them invalidates the
    // slider's recorded offsets, so this is the one place to retire it
    if (typeof closeSlider === "function") closeSlider();

    undoStack.push(expression);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
}

function undo() {
    if (!undoStack.length) return;
    redoStack.push(expression);
    expression = undoStack.pop();
    updateDisplay();
}

function redo() {
    if (!redoStack.length) return;
    undoStack.push(expression);
    expression = redoStack.pop();
    updateDisplay();
}

// =====================================================================
// SOUND
// =====================================================================

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const ctx = new AudioCtx();

function ensureAudio() {
    if (ctx.state === "suspended") ctx.resume();
}

document.addEventListener("pointerdown", ensureAudio, { once: true });
document.addEventListener("keydown", ensureAudio, { once: true });

// crisp modern UI tick — short sine blip with a fast attack/decay envelope
function playTick(freq = 880) {
    if (!soundOn) return;
    ensureAudio();

    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.92, now + 0.05);

    filter.type = "lowpass";
    filter.frequency.value = 4000;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.1);
}

// ✨ CONFIRM CHIME (=) — bright ascending two-note ping
function playEqualsSound() {
    if (!soundOn) return;
    ensureAudio();

    const now = ctx.currentTime;

    [660, 990].forEach((freq, i) => {
        const start = now + i * 0.08;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.34);
    });
}

function playErrorSound() {
    if (!soundOn) return;
    ensureAudio();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.18);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.22);
}

document.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
        if (btn.id === "equals") {
            playEqualsSound();
        } else if (btn.classList.contains("operator")) {
            playTick(660);
        } else if (btn.classList.contains("sci") || btn.classList.contains("chip")) {
            playTick(1040);
        } else if (btn.classList.contains("num")) {
            playTick(880);
        } else {
            playTick(520);
        }

        btn.classList.remove("pulse");
        void btn.offsetWidth;
        btn.classList.add("pulse");
    });
});

// =====================================================================
// INPUT
// =====================================================================

function isFresh() {
    return expression === "0";
}

/* The number currently being typed. "±" starts a new one (the error bar),
   so it counts as a boundary — otherwise 5.2±0.1 rejects its second dot. */
function trailingSegment() {
    const match = expression.match(/[^+\-*/(^±]*$/);
    return match ? match[0] : "";
}

function handleNumber(value) {
    if (value === "." && trailingSegment().includes(".")) return;

    pushUndo();

    if (isFresh()) {
        expression = value === "." ? "0." : value;
    } else {
        expression += value;
    }

    updateDisplay();
}

document.querySelectorAll(".num").forEach(button => {
    button.addEventListener("click", () => handleNumber(button.textContent));
});

function setOperator(op) {
    pushUndo();

    if (isFresh() && op !== "-") {
        // let the previous answer flow into a new calculation
        expression = lastResult !== null ? String(lastResult) : "0";
    }

    const lastChar = expression.slice(-1);

    if (["+", "-", "*", "/", "^"].includes(lastChar)) {
        if (op === "-" && lastChar !== "-" && lastChar !== "+") {
            expression += op;
        } else {
            expression = expression.slice(0, -1) + op;
        }
    } else if (lastChar === "(") {
        if (op === "-") expression += op;
    } else {
        expression += op;
    }

    updateDisplay();
}

$("plus").addEventListener("click", () => setOperator("+"));
$("minus").addEventListener("click", () => setOperator("-"));
$("times").addEventListener("click", () => setOperator("*"));
$("divide").addEventListener("click", () => setOperator("/"));
$("power").addEventListener("click", () => setOperator("^"));
$("mod").addEventListener("click", () => appendRaw("mod"));

function appendRaw(text) {
    pushUndo();

    /* A fresh "0" is a placeholder, so anything that starts a value replaces
       it — letters included, otherwise typing "sin(30)" yields "0sin(30)". */
    if (isFresh() && (/^[\dπ(]/.test(text) || IDENT_CHAR.test(text[0]))) {
        expression = text;
    } else {
        expression += text;
    }

    updateDisplay();
}

function insertParen(type) {
    pushUndo();

    if (type === "(") {
        expression = isFresh() ? "(" : expression + "(";
    } else {
        const open = (expression.match(/\(/g) || []).length;
        const close = (expression.match(/\)/g) || []).length;
        if (open > close && /[\d)π!]$/.test(expression)) {
            expression += ")";
        }
    }

    updateDisplay();
}

$("paren-open").addEventListener("click", () => insertParen("("));
$("paren-close").addEventListener("click", () => insertParen(")"));

/* Functions wrap the number already on screen (30 -> sin(30)), which is what
   people expect from a calculator; with no trailing number they open a call. */
function applyFunction(name) {
    if (name === "10^") {
        appendRaw("10^");
        return;
    }

    const info = extractTrailingNumber(expression);

    pushUndo();

    if (info && info.end === expression.length) {
        const inner = expression.slice(info.start, info.end);
        expression = expression.slice(0, info.start) + name + "(" + inner + ")";
    } else if (isFresh()) {
        expression = name + "(";
    } else {
        expression += name + "(";
    }

    updateDisplay();
}

document.querySelectorAll(".fn").forEach(btn => {
    btn.addEventListener("click", () => {
        applyFunction(secondMode ? btn.dataset.alt : btn.dataset.fn);
        if (secondMode) setSecond(false);
    });
});

$("const-pi").addEventListener("click", () => appendRaw("π"));
$("const-e").addEventListener("click", () => appendRaw("e"));
$("factorial").addEventListener("click", () => appendRaw("!"));

// "±" only makes sense straight after a number, and only once per number
$("uncert").addEventListener("click", () => {
    if (!/[\d.]$/.test(expression) || /±[\d.]*$/.test(expression)) {
        showToast(t("toast.needNumberFirst"));
        return;
    }
    appendRaw("±");
});

$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);

// ---- unary helpers that rewrite the trailing number ----

function extractTrailingNumber(expr) {
    const numMatch = expr.match(/\d*\.?\d+$/);
    if (!numMatch) return null;

    let start = numMatch.index;
    let numStr = numMatch[0];

    if (start > 0 && expr[start - 1] === "-") {
        const before = expr[start - 2];
        if (before === undefined || "+-*/(^".includes(before)) {
            start -= 1;
            numStr = "-" + numStr;
        }
    }

    return { start, end: expr.length, value: parseFloat(numStr) };
}

function applyUnary(fn) {
    const info = extractTrailingNumber(expression);
    if (!info) return;

    const result = fn(info.value);
    if (!isFinite(result) || Number.isNaN(result)) {
        showMessage(t("msg.invalidOperation"));
        playErrorSound();
        expression = "0";
        return;
    }

    pushUndo();
    expression = expression.slice(0, info.start) + String(Number(result.toPrecision(12))) + expression.slice(info.end);
    updateDisplay();
}

/* The percent key everyone expects: "50 + 10%" is 55, not 50.1, because the
   10% is read as a share OF the left operand. After × and ÷ it stays a plain
   hundredth, which is what those cases mean. */
function applyPercent() {
    const info = extractTrailingNumber(expression);
    if (!info) return;

    const before = expression.slice(0, info.start);
    const operator = before.trim().slice(-1);

    if ((operator === "+" || operator === "-") && before.length > 1) {
        const baseText = before.trim().slice(0, -1);

        try {
            const base = evaluate(baseText);
            if (base && isFinite(base.v)) {
                const share = (base.v * info.value) / 100;
                pushUndo();
                expression = before + String(Number(share.toPrecision(12)));
                updateDisplay();
                return;
            }
        } catch (e) {
            /* left side is not evaluable on its own: fall through */
        }
    }

    applyUnary(v => v / 100);
}

$("sqrt").addEventListener("click", () => applyUnary(Math.sqrt));
$("square").addEventListener("click", () => applyUnary(v => v * v));
$("percent").addEventListener("click", applyPercent);
$("inverse").addEventListener("click", () => applyUnary(v => 1 / v));

// =====================================================================
// CALCULATE
// =====================================================================

/* Turn a result back into something the parser can read, so the next
   calculation can continue from it — including its unit and error bar. */
function toExpressionString(q) {
    let value = q.v;
    let uncertainty = q.u;
    let suffix = "";
    let exact = q.r;

    if (q.unit && UNITS[q.unit.label]) {
        value /= q.unit.factor;
        uncertainty /= q.unit.factor;
        suffix = q.unit.label;
        exact = q.unit.rFactor ? ratDiv(exact, q.unit.rFactor) : null;
    }

    if (exact) {
        // "(1/3)" re-parses to exactly 1/3, so chaining stays lossless
        if (ratIsWhole(exact)) return exact.n + suffix;
        if (!suffix) return "(" + exact.n + "/" + exact.d + ")";
    }

    let text = String(Number(value.toPrecision(12)));
    if (uncertainty > 0) text += "±" + Number(uncertainty.toPrecision(6));
    if (suffix) text += suffix;

    return text;
}

let stepTimers = [];

function clearStepAnimation() {
    stepTimers.forEach(clearTimeout);
    stepTimers = [];
}

function commitResult(previous, result) {
    const formatted = formatQuantity(result);

    exprLine.textContent = previous;
    resultLine.textContent = formatted;
    resultLine.classList.remove("preview");
    fitResult();

    announce(t("msg.equals", { expr: previous, result: formatted }));

    lastResult = result.v;
    pushUndo();

    const reusable = toExpressionString(result);
    expression = reusable;

    pushHistory(previous, formatted, reusable);
}

// warp mode: walk the expression through each evaluation step before landing
function animateSteps(previous, result) {
    let steps;
    try {
        steps = evaluationSteps(expression);
    } catch (e) {
        commitResult(previous, result);
        return;
    }

    if (steps.length < 3) {
        commitResult(previous, result);
        return;
    }

    clearStepAnimation();
    exprLine.classList.add("warping");

    steps.slice(1, -1).forEach((step, index) => {
        stepTimers.push(setTimeout(() => {
            exprLine.textContent = step;
            playTick(760 + index * 60);
        }, 380 * (index + 1)));
    });

    stepTimers.push(setTimeout(() => {
        exprLine.classList.remove("warping");
        commitResult(previous, result);
    }, 380 * (steps.length - 1)));
}

function calculate() {
    if (isFresh()) return;

    clearStepAnimation();
    exprLine.classList.remove("warping");

    let result;
    try {
        result = evaluate(expression);
    } catch (e) {
        showMessage(e.message || t("msg.error"));
        playErrorSound();
        expression = "0";
        return;
    }

    if (!result || Number.isNaN(result.v)) {
        showMessage(t("msg.undefinedResult"));
        playErrorSound();
        expression = "0";
        return;
    }

    if (!isFinite(result.v)) {
        showMessage(t("msg.divideByZero"));
        playErrorSound();
        expression = "0";
        return;
    }

    const previous = prettify(expression);

    if (stepMode) {
        animateSteps(previous, result);
    } else {
        commitResult(previous, result);
    }
}

// =====================================================================
// CLEAR / BACKSPACE / SIGN
// =====================================================================

function clearAll() {
    pushUndo();
    expression = "0";
    updateDisplay();
}

$("clear").addEventListener("click", clearAll);

function backspace() {
    pushUndo();

    if (expression.length <= 1) {
        expression = "0";
    } else {
        // remove a whole function name, not one letter at a time
        const fnMatch = expression.match(/(sin|cos|tan|asin|acos|atan|ln|log|exp|sqrt|abs|mod)\($|(sin|cos|tan|asin|acos|atan|ln|log|exp|sqrt|abs|mod)$/);
        if (fnMatch) {
            expression = expression.slice(0, fnMatch.index);
        } else {
            expression = expression.slice(0, -1);
        }
        if (expression === "") expression = "0";
    }

    updateDisplay();
}

$("backspace").addEventListener("click", backspace);

function toggleSign() {
    if (isFresh()) return;

    pushUndo();

    const info = extractTrailingNumber(expression);
    if (info) {
        const negated = -info.value;
        expression = expression.slice(0, info.start) + String(negated) + expression.slice(info.end);
    } else if (expression.startsWith("-")) {
        expression = expression.slice(1);
    } else {
        expression = "-" + expression;
    }

    updateDisplay();
}

$("plusminus").addEventListener("click", toggleSign);

// =====================================================================
// MODES: 2nd, angle, sound, scientific pad
// =====================================================================

function setSecond(on) {
    secondMode = on;
    const btn = $("second");
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));

    document.querySelectorAll(".fn").forEach(b => {
        const label = on ? b.dataset.alt : b.dataset.fn;
        b.textContent = label === "10^" ? "10ˣ" : label;
    });
}

$("second").addEventListener("click", () => setSecond(!secondMode));

function setAngleMode(mode) {
    angleMode = mode;
    storeSet("ovid-angle", mode);
    $("angle-toggle").textContent = mode;
    angleIndicator.textContent = mode;
    updateDisplay();
}

$("angle-toggle").addEventListener("click", () => {
    setAngleMode(angleMode === "DEG" ? "RAD" : "DEG");
    showToast(t("toast.angleMode", { mode: angleMode }));
});

setAngleMode(angleMode);

function setSound(on) {
    soundOn = on;
    storeSet("ovid-sound", on ? "on" : "off");
    const btn = $("sound-toggle");
    btn.textContent = on ? "🔊" : "🔇";
    btn.setAttribute("aria-pressed", String(on));
}

$("sound-toggle").addEventListener("click", () => {
    setSound(!soundOn);
    showToast(t(soundOn ? "toast.soundOn" : "toast.soundOff"));
});

setSound(soundOn);

/* Answers the most common accessibility complaint about calculators:
   "the buttons and text are too small". Cycles through three sizes. */
const SIZE_STEPS = ["normal", "large", "xlarge"];
const SIZE_LABELS = { normal: "A", large: "A+", xlarge: "A++" };
const SIZE_TOASTS = { normal: "toast.sizeNormal", large: "toast.sizeLarge", xlarge: "toast.sizeXLarge" };

let sizeMode = storeGet("ovid-size") || "normal";
// a value from before the internal names were translated to English —
// treat it the same as no saved preference rather than breaking
if (!SIZE_STEPS.includes(sizeMode)) sizeMode = "normal";

function setSizeMode(mode) {
    sizeMode = SIZE_STEPS.includes(mode) ? mode : "normal";
    storeSet("ovid-size", sizeMode);

    document.body.classList.remove("size-large", "size-xlarge");
    if (sizeMode !== "normal") document.body.classList.add("size-" + sizeMode);

    $("size-toggle").textContent = SIZE_LABELS[sizeMode];
}

$("size-toggle").addEventListener("click", () => {
    const next = SIZE_STEPS[(SIZE_STEPS.indexOf(sizeMode) + 1) % SIZE_STEPS.length];
    setSizeMode(next);
    showToast(t(SIZE_TOASTS[sizeMode]));
});

setSizeMode(sizeMode);

function setStepMode(on) {
    stepMode = on;
    storeSet("ovid-step", on ? "on" : "off");
    const btn = $("step-toggle");
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
}

$("step-toggle").addEventListener("click", () => {
    setStepMode(!stepMode);
    showToast(t(stepMode ? "toast.stepOn" : "toast.stepOff"));
});

setStepMode(stepMode);

function setFractionMode(on) {
    fractionMode = on;
    storeSet("ovid-fraction", on ? "on" : "off");

    const btn = $("fraction-toggle");
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));

    updateDisplay();
}

$("fraction-toggle").addEventListener("click", () => {
    setFractionMode(!fractionMode);
    showToast(t(fractionMode ? "toast.fractionOn" : "toast.fractionOff"));
});

setFractionMode(fractionMode);

$("sci-toggle").addEventListener("click", () => {
    const pad = $("sci-advanced");
    const open = pad.hasAttribute("hidden");
    if (open) {
        pad.removeAttribute("hidden");
    } else {
        pad.setAttribute("hidden", "");
    }
    $("sci-toggle").setAttribute("aria-expanded", String(open));
    $("sci-toggle").classList.toggle("active", open);
});

// =====================================================================
// TOAST
// =====================================================================

let toastTimer;
function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

// =====================================================================
// MEMORY
// =====================================================================

function currentValue() {
    try {
        const value = evaluate(expression);
        return value && isFinite(value.v) ? value.v : null;
    } catch (e) {
        return null;
    }
}

function persistMemory() {
    storeSet("ovid-memory", String(memory));
    memoryIndicator.classList.toggle("active", memory !== 0);
}

$("mplus").addEventListener("click", () => {
    const value = currentValue();
    if (value === null) return;
    memory += value;
    persistMemory();
    showToast(t("toast.memoryAdded", { v: formatNumber(memory) }));
});

$("mminus").addEventListener("click", () => {
    const value = currentValue();
    if (value === null) return;
    memory -= value;
    persistMemory();
    showToast(t("toast.memorySubtracted", { v: formatNumber(memory) }));
});

$("mr").addEventListener("click", () => {
    pushUndo();
    expression = String(Number(memory.toPrecision(12)));
    updateDisplay();
});

$("mc").addEventListener("click", () => {
    memory = 0;
    persistMemory();
    showToast(t("toast.memoryCleared"));
});

persistMemory();

// =====================================================================
// HISTORY
// =====================================================================

function persistHistory() {
    storeSet("ovid-history", JSON.stringify(history));
}

function pushHistory(expr, result, reusable) {
    // `reusable` is the parseable form; `result` is the pretty one
    history.unshift({ expr, result, reusable, at: Date.now() });
    history = history.slice(0, 50);
    persistHistory();
    renderHistory();
}

function renderHistory() {
    historyList.textContent = "";

    if (!history.length) {
        const empty = document.createElement("li");
        empty.className = "panel-empty";
        empty.textContent = t("panel.historyEmpty");
        historyList.appendChild(empty);
        return;
    }

    history.forEach(item => {
        const li = document.createElement("li");
        li.className = "history-item";

        const exprSpan = document.createElement("span");
        exprSpan.className = "history-expr";
        exprSpan.textContent = item.expr;

        const resultSpan = document.createElement("span");
        resultSpan.className = "history-result";
        resultSpan.textContent = "= " + item.result;

        li.append(exprSpan, resultSpan);

        li.addEventListener("click", () => {
            pushUndo();
            expression = item.reusable || item.result.replace(/\s/g, "");
            updateDisplay();
            closePanel();
            showToast(t("toast.resultLoaded"));
        });

        historyList.appendChild(li);
    });
}

// destructive and irreversible, so it asks first
$("history-clear").addEventListener("click", () => {
    if (!history.length) {
        showToast(t("toast.historyEmpty"));
        return;
    }
    if (!confirm(t("toast.confirmHistory"))) return;

    history = [];
    persistHistory();
    renderHistory();
    showToast(t("toast.historyCleared"));
});

renderHistory();

// =====================================================================
// CONSTANTS (space-native: this is a space calculator, so it knows space)
// =====================================================================

const CONSTANT_LIBRARY = [
    { symbol: "c", key: "const.c", value: 299792458, unit: "m/s" },
    { symbol: "g", key: "const.g", value: 9.80665, unit: "m/s²" },
    { symbol: "G", key: "const.G", value: 6.6743e-11, unit: "m³/kg·s²" },
    { symbol: "h", key: "const.h", value: 6.62607015e-34, unit: "J·s" },
    { symbol: "Nₐ", key: "const.Na", value: 6.02214076e23, unit: "1/mol" },
    { symbol: "AU", key: "const.AU", value: 1.495978707e11, unit: "m" },
    { symbol: "ly", key: "const.ly", value: 9.4607304725808e15, unit: "m" },
    { symbol: "pc", key: "const.pc", value: 3.0856775814913673e16, unit: "m" },
    { symbol: "M☉", key: "const.Msun", value: 1.98892e30, unit: "kg" },
    { symbol: "R⊕", key: "const.Rearth", value: 6371000, unit: "m" },
    { symbol: "φ", key: "const.phi", value: 1.618033988749895, unit: "" }
];

function renderConstants() {
    const list = $("constants-list");
    list.textContent = "";

    CONSTANT_LIBRARY.forEach(c => {
        const li = document.createElement("li");
        li.className = "constant-item";

        const head = document.createElement("div");
        head.className = "constant-head";

        const sym = document.createElement("span");
        sym.className = "constant-symbol";
        sym.textContent = c.symbol;

        const name = document.createElement("span");
        name.className = "constant-name";
        name.textContent = t(c.key);

        head.append(sym, name);

        const val = document.createElement("span");
        val.className = "constant-value";
        val.textContent = formatNumber(c.value) + (c.unit ? " " + c.unit : "");

        li.append(head, val);

        li.addEventListener("click", () => {
            appendRaw(String(c.value));
            closePanel();
            showToast(t("toast.constantAdded", { s: c.symbol }));
        });

        list.appendChild(li);
    });
}

renderConstants();

// =====================================================================
// UNIT PALETTE — click a unit to append it to the current number
// =====================================================================

const UNIT_GROUPS = [
    { key: "tools.length", units: ["mm", "cm", "m", "km", "ft", "mi", "AU", "ly", "pc"] },
    { key: "tools.mass", units: ["mg", "g", "kg", "t", "lb"] },
    { key: "tools.time", units: ["ms", "s", "min", "h", "day", "yr"] },
    { key: "tools.data", units: ["B", "KB", "MB", "GB", "TB"] }
];

function renderUnitPalette() {
    const container = $("units-groups");
    container.textContent = "";

    UNIT_GROUPS.forEach(group => {
        const wrap = document.createElement("div");
        wrap.className = "unit-group";

        const title = document.createElement("div");
        title.className = "unit-group-title";
        title.textContent = t(group.key);

        const row = document.createElement("div");
        row.className = "unit-chips";

        group.units.forEach(unit => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "unit-chip";
            chip.textContent = unit;

            chip.addEventListener("click", () => {
                if (!/[\d.]$/.test(expression)) {
                    showToast(t("toast.needNumberFirst"));
                    return;
                }
                appendRaw(unit);
                playTick(1040);
            });

            row.appendChild(chip);
        });

        wrap.append(title, row);
        container.appendChild(wrap);
    });
}

renderUnitPalette();

// =====================================================================
// UNIT CONVERTER
// =====================================================================

/* Categories use stable ids so the data never depends on the display
   language; the label comes from the dictionary at render time. */
const CONVERTER_UNITS = {
    length: {
        mm: 0.001, cm: 0.01, m: 1, km: 1000,
        in: 0.0254, ft: 0.3048, mi: 1609.344,
        "nmi": 1852, AU: 1.495978707e11, ly: 9.4607304725808e15
    },
    mass: {
        mg: 1e-6, g: 0.001, kg: 1, t: 1000,
        oz: 0.028349523125, lb: 0.45359237, "M⊕": 5.9722e24
    },
    time: {
        ms: 0.001, s: 1, min: 60, h: 3600,
        day: 86400, week: 604800, yr: 31557600
    },
    speed: {
        "m/s": 1, "km/h": 0.277777778, mph: 0.44704,
        knot: 0.514444444, c: 299792458
    },
    data: {
        bit: 0.125, B: 1, KB: 1024, MB: 1048576,
        GB: 1073741824, TB: 1099511627776
    },
    area: {
        "m²": 1, "km²": 1e6, "cm²": 1e-4,
        ha: 10000, acre: 4046.8564224, "ft²": 0.09290304
    },
    volume: {
        ml: 0.001, L: 1, "m³": 1000,
        gal: 3.785411784, cup: 0.2365882365
    },
    temperature: null // handled separately: offsets, not ratios
};

const TEMP_UNITS = ["°C", "°F", "K"];

function toCelsius(value, unit) {
    if (unit === "°C") return value;
    if (unit === "°F") return (value - 32) * 5 / 9;
    return value - 273.15;
}

function fromCelsius(celsius, unit) {
    if (unit === "°C") return celsius;
    if (unit === "°F") return celsius * 9 / 5 + 32;
    return celsius + 273.15;
}

const categorySelect = $("convert-category");
const fromSelect = $("convert-from");
const toSelect = $("convert-to");
const convertInput = $("convert-input");
const convertResult = $("convert-result");

function renderCategories() {
    const chosen = categorySelect.value;
    categorySelect.textContent = "";

    Object.keys(CONVERTER_UNITS).forEach(cat => {
        const option = document.createElement("option");
        option.value = cat;
        option.textContent = t("tools." + cat);
        categorySelect.appendChild(option);
    });

    if (chosen) categorySelect.value = chosen;
}

renderCategories();

function unitsFor(category) {
    return category === "temperature" ? TEMP_UNITS : Object.keys(CONVERTER_UNITS[category]);
}

function populateUnits() {
    const units = unitsFor(categorySelect.value);

    [fromSelect, toSelect].forEach(select => {
        select.textContent = "";
        units.forEach(u => {
            const option = document.createElement("option");
            option.value = u;
            option.textContent = u;
            select.appendChild(option);
        });
    });

    fromSelect.selectedIndex = 0;
    toSelect.selectedIndex = Math.min(1, units.length - 1);
    runConversion();
}

function convertValue() {
    const value = parseFloat(convertInput.value);
    if (!isFinite(value)) return null;

    const category = categorySelect.value;

    if (category === "temperature") {
        return fromCelsius(toCelsius(value, fromSelect.value), toSelect.value);
    }

    const table = CONVERTER_UNITS[category];
    return (value * table[fromSelect.value]) / table[toSelect.value];
}

function runConversion() {
    const result = convertValue();
    convertResult.textContent = result === null
        ? "—"
        : formatNumber(result) + " " + toSelect.value;
}

categorySelect.addEventListener("change", populateUnits);
[fromSelect, toSelect].forEach(s => s.addEventListener("change", runConversion));
convertInput.addEventListener("input", runConversion);

$("convert-swap").addEventListener("click", () => {
    const from = fromSelect.value;
    fromSelect.value = toSelect.value;
    toSelect.value = from;
    runConversion();
});

$("convert-use").addEventListener("click", () => {
    const result = convertValue();
    if (result === null) return;
    pushUndo();
    expression = String(Number(result.toPrecision(12)));
    updateDisplay();
    closePanel();
    showToast(t("toast.resultSent"));
});

populateUnits();

// =====================================================================
// TOOLS — number theory, base conversion, list statistics
// =====================================================================

const NT_LIMIT = 1e12; // trial division stays instant below this

function primeFactors(n) {
    const factors = [];

    for (let d = 2; d * d <= n; d += (d === 2 ? 1 : 2)) {
        while (n % d === 0) {
            factors.push(d);
            n /= d;
        }
    }

    if (n > 1) factors.push(n);
    return factors;
}

function groupFactors(factors) {
    const groups = [];

    factors.forEach(f => {
        const last = groups[groups.length - 1];
        if (last && last.base === f) last.exp++;
        else groups.push({ base: f, exp: 1 });
    });

    return groups;
}

function divisorsOf(n) {
    const small = [];
    const large = [];

    for (let d = 1; d * d <= n; d++) {
        if (n % d !== 0) continue;
        small.push(d);
        if (d !== n / d) large.push(n / d);
    }

    return small.concat(large.reverse());
}

const gcdOf = (a, b) => b ? gcdOf(b, a % b) : Math.abs(a);
const lcmOf = (a, b) => (!a || !b) ? 0 : Math.abs(a * b) / gcdOf(a, b);

function renderRow(container, label, value) {
    const row = document.createElement("div");
    row.className = "tool-row";

    const key = document.createElement("span");
    key.className = "tool-key";
    key.textContent = label;

    const val = document.createElement("span");
    val.className = "tool-val";
    val.textContent = value;

    row.append(key, val);
    container.appendChild(row);
}

function renderNumberTheory() {
    const box = $("nt-result");
    box.textContent = "";

    const n = Number($("nt-input").value);

    if (!Number.isInteger(n) || n < 1) {
        renderRow(box, t("tools.warning"), t("tools.needInteger"));
        return;
    }
    if (n > NT_LIMIT) {
        renderRow(box, t("tools.warning"), t("tools.tooLarge"));
        return;
    }

    const factors = primeFactors(n);
    const groups = groupFactors(factors);

    const notation = n === 1
        ? t("tools.noPrimeFactors")
        : groups.map(g => g.exp === 1 ? g.base : g.base + "^" + g.exp).join(" × ");

    renderRow(box, t("tools.primeFactors"), notation);
    renderRow(box, t("tools.isPrime"), factors.length === 1 && n > 1 ? t("tools.yes") : t("tools.no"));

    const divisors = divisorsOf(n);
    renderRow(box, t("tools.divisorCount"), String(divisors.length));
    renderRow(box, t("tools.divisorSum"), String(divisors.reduce((s, d) => s + d, 0)));

    const shown = divisors.length > 24
        ? divisors.slice(0, 24).join(", ") + " …"
        : divisors.join(", ");
    renderRow(box, t("tools.divisors"), shown);
}

function renderNumberPair() {
    const box = $("nt-pair");
    box.textContent = "";

    const a = Number($("nt-input").value);
    const b = Number($("nt-second").value);

    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1) return;
    if (a > NT_LIMIT || b > NT_LIMIT) return;

    renderRow(box, t("tools.gcd") + " (" + a + ", " + b + ")", String(gcdOf(a, b)));
    renderRow(box, t("tools.lcm") + " (" + a + ", " + b + ")", String(lcmOf(a, b)));
    renderRow(box, t("tools.coprime"), gcdOf(a, b) === 1 ? t("tools.yes") : t("tools.no"));
}

["nt-input", "nt-second"].forEach(id => {
    $(id).addEventListener("input", () => {
        renderNumberTheory();
        renderNumberPair();
    });
});

// ---- base conversion ----

function renderBases() {
    const box = $("base-result");
    box.textContent = "";

    const raw = $("base-input").value.trim();
    const from = Number($("base-from").value);

    if (!raw) return;

    const negative = raw.startsWith("-");
    const digits = negative ? raw.slice(1) : raw;

    const allowed = "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, from);
    if (!digits.length || [...digits.toLowerCase()].some(c => !allowed.includes(c))) {
        renderRow(box, t("tools.warning"), t("tools.invalidForBase", { n: from }));
        return;
    }

    let value;
    try {
        value = [...digits.toLowerCase()].reduce(
            (acc, c) => acc * BigInt(from) + BigInt(allowed.indexOf(c)),
            0n
        );
    } catch (e) {
        renderRow(box, t("tools.warning"), t("tools.unreadable"));
        return;
    }

    if (negative) value = -value;

    renderRow(box, t("tools.decimal"), value.toString(10));
    renderRow(box, t("tools.binary"), value.toString(2));
    renderRow(box, t("tools.octal"), value.toString(8));
    renderRow(box, t("tools.hex"), value.toString(16).toUpperCase());

    if (value >= 0n && value <= 0xffffffffn) {
        renderRow(box, t("tools.bits"), value.toString(2).length);
    }
}

$("base-input").addEventListener("input", renderBases);
$("base-from").addEventListener("change", renderBases);

// ---- list statistics ----

function renderStats() {
    const box = $("stat-result");
    box.textContent = "";

    const numbers = $("stat-input").value
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map(Number)
        .filter(Number.isFinite);

    if (!numbers.length) {
        renderRow(box, t("tools.warning"), t("tools.needNumber"));
        return;
    }

    const n = numbers.length;
    const sorted = [...numbers].sort((a, b) => a - b);
    const sum = numbers.reduce((s, x) => s + x, 0);
    const mean = sum / n;

    const median = n % 2
        ? sorted[(n - 1) / 2]
        : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

    const counts = new Map();
    numbers.forEach(x => counts.set(x, (counts.get(x) || 0) + 1));
    const topCount = Math.max(...counts.values());
    const modes = topCount > 1
        ? [...counts.entries()].filter(([, c]) => c === topCount).map(([x]) => x)
        : [];

    // population divides by n; the sample estimate divides by n-1 (Bessel)
    const squaredError = numbers.reduce((s, x) => s + (x - mean) ** 2, 0);
    const popVar = squaredError / n;
    const sampleVar = n > 1 ? squaredError / (n - 1) : null;

    renderRow(box, t("tools.count"), String(n));
    renderRow(box, t("tools.sum"), formatNumber(sum));
    renderRow(box, t("tools.mean"), formatNumber(mean));
    renderRow(box, t("tools.median"), formatNumber(median));
    renderRow(box, t("tools.mode"), modes.length ? modes.join(", ") : t("tools.none"));
    renderRow(box, t("tools.min"), formatNumber(sorted[0]));
    renderRow(box, t("tools.max"), formatNumber(sorted[n - 1]));
    renderRow(box, t("tools.range"), formatNumber(sorted[n - 1] - sorted[0]));
    renderRow(box, t("tools.varPop"), formatNumber(popVar));
    renderRow(box, t("tools.sdPop"), formatNumber(Math.sqrt(popVar)));

    if (sampleVar !== null) {
        renderRow(box, t("tools.varSample"), formatNumber(sampleVar));
        renderRow(box, t("tools.sdSample"), formatNumber(Math.sqrt(sampleVar)));
    }
}

$("stat-input").addEventListener("input", renderStats);

renderNumberTheory();
renderNumberPair();
renderBases();
renderStats();

/* The units hint contains inline <code> samples, so it is assembled from
   the translated sentence rather than injected as HTML. */
function renderUnitsHint() {
    const box = $("units-hint");
    if (!box) return;

    box.textContent = "";
    const parts = t("panel.unitsHint").split(/\{[ab]\}/);
    const samples = ["5 km + 300 m", "100 km / 2 h"];

    parts.forEach((chunk, i) => {
        box.appendChild(document.createTextNode(chunk));
        if (i < parts.length - 1) {
            const code = document.createElement("code");
            code.textContent = samples[i];
            box.appendChild(code);
        }
    });
}

renderUnitsHint();

/* Redraw everything this file owns when the language changes. */
onLocaleChange(() => {
    renderUnitsHint();
    renderCategories();
    renderConstants();
    renderUnitPalette();
    renderHistory();
    populateUnits();
    renderNumberTheory();
    renderNumberPair();
    renderBases();
    renderStats();
    updateDisplay();
});

// =====================================================================
// SIDE PANEL + TABS
// =====================================================================

function openPanel() {
    sidePanel.classList.add("open");
    sidePanel.setAttribute("aria-hidden", "false");
    panelToggle.setAttribute("aria-expanded", "true");
}

function closePanel() {
    sidePanel.classList.remove("open");
    sidePanel.setAttribute("aria-hidden", "true");
    panelToggle.setAttribute("aria-expanded", "false");
}

panelToggle.addEventListener("click", () => {
    sidePanel.classList.contains("open") ? closePanel() : openPanel();
});

document.querySelectorAll(".panel-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".panel-tab").forEach(t => {
            t.classList.remove("active");
            t.setAttribute("aria-selected", "false");
        });
        document.querySelectorAll(".panel-pane").forEach(p => p.classList.remove("active"));

        tab.classList.add("active");
        tab.setAttribute("aria-selected", "true");
        $("pane-" + tab.dataset.tab).classList.add("active");
        playTick(1040);
    });
});

// =====================================================================
// COPY RESULT
// =====================================================================

resultLine.addEventListener("click", async () => {
    const text = resultLine.textContent.replace(/\s/g, "");
    try {
        await navigator.clipboard.writeText(text);
        showToast(t("toast.copied", { v: text }));
    } catch (e) {
        showToast(t("toast.copyFailed"));
    }
});

// =====================================================================
// KEYBOARD
// =====================================================================

document.addEventListener("keydown", (event) => {
    // don't hijack typing inside the converter or Mission Control inputs
    if (event.target.matches("input, select, textarea")) return;

    // an open dialog owns the keyboard, Escape included
    if (document.querySelector(".mission-modal.open")) return;

    const key = event.key;

    if ((key >= "0" && key <= "9") || key === ".") {
        handleNumber(key);
        return;
    }

    if (["+", "-", "*", "/", "^"].includes(key)) {
        setOperator(key);
        return;
    }

    if (key === "(" || key === ")") {
        insertParen(key);
        return;
    }

    if (key === "!") { appendRaw("!"); return; }
    if (key === "%") { applyPercent(); return; }
    if (key === "±") { appendRaw("±"); return; }

    /* Let people type "sin(30)" or "5km" instead of hunting for buttons —
       the parser already understands both, the keyboard just ignored them. */
    if (key.length === 1 && IDENT_CHAR.test(key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        appendRaw(key);
        return;
    }

    if (key === "Enter" || key === "=") {
        event.preventDefault();
        playEqualsSound();
        screenShake();
        spawnParticles(window.innerWidth / 2, window.innerHeight / 2);
        calculate();
        return;
    }

    if (key === "Backspace") { backspace(); return; }

    if (key === "Delete") { clearAll(); return; }

    if (key === "Escape") {
        sidePanel.classList.contains("open") ? closePanel() : clearAll();
        return;
    }

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
    }

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
    }
});

// =====================================================================
// 🚀 EFFECTS
// =====================================================================

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function screenShake() {
    if (reducedMotion) return;

    const calc = document.querySelector(".calculator");
    calc.classList.add("shake");
    setTimeout(() => calc.classList.remove("shake"), 300);
}

function spawnParticles(x, y) {
    if (reducedMotion) return;

    for (let i = 0; i < 12; i++) {
        const p = document.createElement("div");
        p.className = "particle";
        document.body.appendChild(p);

        p.style.left = x + "px";
        p.style.top = y + "px";

        const angle = Math.random() * 360;
        const distance = Math.random() * 90;

        p.animate([
            { transform: "translate(0,0)", opacity: 1 },
            { transform: `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px)`, opacity: 0 }
        ], { duration: 650, easing: "ease-out" });

        setTimeout(() => p.remove(), 650);
    }
}

$("equals").addEventListener("click", () => {
    screenShake();
    spawnParticles(window.innerWidth / 2, window.innerHeight / 2);
    calculate();
});

// ambient space hum — fades in smoothly instead of snapping to full volume
function startSpaceHum() {
    if (!soundOn) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 55;

    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.009, ctx.currentTime + 3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
}

startSpaceHum();

// =====================================================================
// OFFLINE SUPPORT
// =====================================================================

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {
            /* offline support is a bonus; ignore when unavailable (e.g. file://) */
        });
    });
}

// =====================================================================
// BOOT
// =====================================================================

updateDisplay();
