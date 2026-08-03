/* =====================================================================
   OVID CALCULATOR
   Expression engine: tokenizer -> shunting-yard -> RPN evaluation.
   Deliberately not eval()/Function(): needed for functions, constants,
   factorial and implicit multiplication, and it keeps input untrusted.
   ===================================================================== */

// ================= STATE =================

let expression = "0";
let lastResult = null;
let angleMode = localStorage.getItem("ovid-angle") || "DEG";
let soundOn = localStorage.getItem("ovid-sound") !== "off";
let secondMode = false;
let memory = Number(localStorage.getItem("ovid-memory")) || 0;
let history = JSON.parse(localStorage.getItem("ovid-history") || "[]");

const undoStack = [];
const redoStack = [];

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

// =====================================================================
// TOKENIZER
// =====================================================================

const FUNCTIONS = {
    sin: x => Math.sin(toRadians(x)),
    cos: x => Math.cos(toRadians(x)),
    tan: x => Math.tan(toRadians(x)),
    asin: x => fromRadians(Math.asin(x)),
    acos: x => fromRadians(Math.acos(x)),
    atan: x => fromRadians(Math.atan(x)),
    ln: Math.log,
    log: Math.log10,
    exp: Math.exp,
    sqrt: Math.sqrt,
    abs: Math.abs
};

const CONSTANTS = {
    "π": Math.PI,
    "e": Math.E
};

// operator: [precedence, associativity, arity]
const OPERATORS = {
    "+": { prec: 1, assoc: "left" },
    "-": { prec: 1, assoc: "left" },
    "*": { prec: 2, assoc: "left" },
    "/": { prec: 2, assoc: "left" },
    "mod": { prec: 2, assoc: "left" },
    "^": { prec: 4, assoc: "right" }
};

// unary minus: binds tighter than */ but looser than ^, so -2^2 === -4
const UNARY_PREC = 3;

function toRadians(x) {
    return angleMode === "DEG" ? (x * Math.PI) / 180 : x;
}

function fromRadians(x) {
    return angleMode === "DEG" ? (x * 180) / Math.PI : x;
}

function tokenize(input) {
    const tokens = [];
    let i = 0;

    while (i < input.length) {
        const ch = input[i];

        if (ch === " ") { i++; continue; }

        // number (supports leading decimal point)
        if (/[0-9.]/.test(ch)) {
            let num = "";
            while (i < input.length && /[0-9.]/.test(input[i])) {
                num += input[i++];
            }
            if ((num.match(/\./g) || []).length > 1) {
                throw new Error("Geçersiz sayı");
            }
            tokens.push({ type: "number", value: parseFloat(num) });
            continue;
        }

        // named tokens: functions, mod, constants
        if (/[a-zπ]/i.test(ch)) {
            let name = "";
            while (i < input.length && /[a-zπ0-9]/i.test(input[i])) {
                name += input[i++];
            }

            if (FUNCTIONS[name]) {
                tokens.push({ type: "function", value: name });
            } else if (name === "mod") {
                tokens.push({ type: "operator", value: "mod" });
            } else if (CONSTANTS[name] !== undefined) {
                tokens.push({ type: "number", value: CONSTANTS[name] });
            } else {
                throw new Error("Bilinmeyen ifade: " + name);
            }
            continue;
        }

        if (OPERATORS[ch]) {
            tokens.push({ type: "operator", value: ch });
            i++;
            continue;
        }

        if (ch === "(" || ch === ")") {
            tokens.push({ type: "paren", value: ch });
            i++;
            continue;
        }

        if (ch === "!") {
            tokens.push({ type: "postfix", value: "!" });
            i++;
            continue;
        }

        throw new Error("Geçersiz karakter: " + ch);
    }

    return tokens;
}

/* Insert the tokens a human leaves out: unary minus becomes a marker,
   and "2π" / "2(3)" / "2sin(1)" get an explicit multiplication. */
function normalize(tokens) {
    const out = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const prev = out[out.length - 1];

        const prevIsValue = prev && (
            prev.type === "number" ||
            prev.type === "postfix" ||
            (prev.type === "paren" && prev.value === ")")
        );

        if (token.type === "operator" && (token.value === "-" || token.value === "+")) {
            const isUnary = !prev ||
                (prev.type === "operator") ||
                (prev.type === "paren" && prev.value === "(");

            if (isUnary) {
                if (token.value === "-") {
                    out.push({ type: "unary", value: "neg" });
                }
                continue;
            }
        }

        const startsValue = token.type === "number" ||
            token.type === "function" ||
            (token.type === "paren" && token.value === "(");

        if (prevIsValue && startsValue) {
            out.push({ type: "operator", value: "*" });
        }

        out.push(token);
    }

    return out;
}

// =====================================================================
// SHUNTING-YARD -> RPN
// =====================================================================

function toRPN(tokens) {
    const output = [];
    const stack = [];

    for (const token of tokens) {
        switch (token.type) {
            case "number":
                output.push(token);
                break;

            case "function":
            case "unary":
                stack.push(token);
                break;

            case "postfix":
                output.push(token);
                break;

            case "operator": {
                const op = OPERATORS[token.value];
                while (stack.length) {
                    const top = stack[stack.length - 1];

                    if (top.type === "function") {
                        output.push(stack.pop());
                        continue;
                    }

                    // unary minus sits below "^" on purpose: -2^2 is -(2^2)
                    const topPrec = top.type === "unary"
                        ? UNARY_PREC
                        : (top.type === "operator" ? OPERATORS[top.value].prec : null);

                    if (topPrec !== null) {
                        const shouldPop = op.assoc === "left"
                            ? topPrec >= op.prec
                            : topPrec > op.prec;
                        if (shouldPop) {
                            output.push(stack.pop());
                            continue;
                        }
                    }
                    break;
                }
                stack.push(token);
                break;
            }

            case "paren":
                if (token.value === "(") {
                    stack.push(token);
                } else {
                    let found = false;
                    while (stack.length) {
                        const top = stack.pop();
                        if (top.type === "paren" && top.value === "(") { found = true; break; }
                        output.push(top);
                    }
                    if (!found) throw new Error("Parantez hatası");
                    const top = stack[stack.length - 1];
                    if (top && (top.type === "function" || top.type === "unary")) {
                        output.push(stack.pop());
                    }
                }
                break;
        }
    }

    while (stack.length) {
        const top = stack.pop();
        if (top.type === "paren") throw new Error("Parantez hatası");
        output.push(top);
    }

    return output;
}

function factorial(n) {
    if (n < 0 || !Number.isInteger(n)) throw new Error("Faktöriyel yalnızca pozitif tam sayılar için");
    if (n > 170) return Infinity;
    let acc = 1;
    for (let i = 2; i <= n; i++) acc *= i;
    return acc;
}

function evalRPN(rpn) {
    const stack = [];

    for (const token of rpn) {
        if (token.type === "number") {
            stack.push(token.value);
            continue;
        }

        if (token.type === "unary") {
            if (!stack.length) throw new Error("Eksik ifade");
            stack.push(-stack.pop());
            continue;
        }

        if (token.type === "postfix") {
            if (!stack.length) throw new Error("Eksik ifade");
            stack.push(factorial(stack.pop()));
            continue;
        }

        if (token.type === "function") {
            if (!stack.length) throw new Error("Eksik ifade");
            stack.push(FUNCTIONS[token.value](stack.pop()));
            continue;
        }

        if (token.type === "operator") {
            if (stack.length < 2) throw new Error("Eksik ifade");
            const b = stack.pop();
            const a = stack.pop();

            switch (token.value) {
                case "+": stack.push(a + b); break;
                case "-": stack.push(a - b); break;
                case "*": stack.push(a * b); break;
                case "/": stack.push(a / b); break;
                case "mod": stack.push(a % b); break;
                case "^": stack.push(Math.pow(a, b)); break;
            }
        }
    }

    if (stack.length !== 1) throw new Error("Eksik ifade");
    return stack[0];
}

function evaluate(input) {
    // auto-close parentheses so the live preview works while typing
    const open = (input.match(/\(/g) || []).length;
    const close = (input.match(/\)/g) || []).length;
    const balanced = input + ")".repeat(Math.max(0, open - close));

    return evalRPN(toRPN(normalize(tokenize(balanced))));
}

// =====================================================================
// FORMATTING & DISPLAY
// =====================================================================

function formatNumber(num) {
    if (Object.is(num, -0)) num = 0;
    if (!isFinite(num)) return num > 0 ? "∞" : "-∞";

    const rounded = Number(num.toPrecision(12));

    if (rounded !== 0 && (Math.abs(rounded) >= 1e15 || Math.abs(rounded) < 1e-9)) {
        const [mantissa, exponent] = rounded.toExponential(6).split("e");
        const trimmed = mantissa.replace(/\.?0+$/, "");
        return trimmed + "×10^" + exponent.replace("+", "");
    }

    // thousand separators keep long results readable, decimals untouched
    const [int, dec] = rounded.toString().split(".");
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return dec ? grouped + "." + dec : grouped;
}

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

function updateDisplay() {
    exprLine.textContent = prettify(expression);

    // live preview — the answer appears before you press "="
    try {
        const value = evaluate(expression);
        if (typeof value === "number" && !Number.isNaN(value)) {
            resultLine.textContent = formatNumber(value);
            resultLine.classList.add("preview");
        } else {
            resultLine.classList.add("preview");
        }
    } catch (e) {
        resultLine.classList.add("preview");
    }
}

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

function trailingSegment() {
    const match = expression.match(/[^+\-*/(^]*$/);
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
    if (isFresh() && /^[\dπe(]/.test(text)) {
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
$("rand").addEventListener("click", () => appendRaw(Math.random().toFixed(6)));

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
        showMessage("Geçersiz işlem");
        playErrorSound();
        expression = "0";
        return;
    }

    pushUndo();
    expression = expression.slice(0, info.start) + String(Number(result.toPrecision(12))) + expression.slice(info.end);
    updateDisplay();
}

$("sqrt").addEventListener("click", () => applyUnary(Math.sqrt));
$("square").addEventListener("click", () => applyUnary(v => v * v));
$("percent").addEventListener("click", () => applyUnary(v => v / 100));
$("inverse").addEventListener("click", () => applyUnary(v => 1 / v));

// =====================================================================
// CALCULATE
// =====================================================================

function calculate() {
    if (isFresh()) return;

    let result;
    try {
        result = evaluate(expression);
    } catch (e) {
        showMessage(e.message || "Hata");
        playErrorSound();
        expression = "0";
        return;
    }

    if (typeof result !== "number" || Number.isNaN(result)) {
        showMessage("Tanımsız sonuç");
        playErrorSound();
        expression = "0";
        return;
    }

    if (!isFinite(result)) {
        showMessage("Sıfıra bölünemez");
        playErrorSound();
        expression = "0";
        return;
    }

    const previous = prettify(expression);
    const formatted = formatNumber(result);

    exprLine.textContent = previous;
    resultLine.textContent = formatted;
    resultLine.classList.remove("preview");

    announce(previous + " eşittir " + formatted);

    lastResult = Number(result.toPrecision(12));
    pushUndo();
    expression = String(lastResult);

    pushHistory(previous, formatted);
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
    localStorage.setItem("ovid-angle", mode);
    $("angle-toggle").textContent = mode;
    angleIndicator.textContent = mode;
    updateDisplay();
}

$("angle-toggle").addEventListener("click", () => {
    setAngleMode(angleMode === "DEG" ? "RAD" : "DEG");
    showToast("Açı birimi: " + angleMode);
});

setAngleMode(angleMode);

function setSound(on) {
    soundOn = on;
    localStorage.setItem("ovid-sound", on ? "on" : "off");
    const btn = $("sound-toggle");
    btn.textContent = on ? "🔊" : "🔇";
    btn.setAttribute("aria-pressed", String(on));
}

$("sound-toggle").addEventListener("click", () => {
    setSound(!soundOn);
    showToast(soundOn ? "Ses açık" : "Ses kapalı");
});

setSound(soundOn);

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
        return typeof value === "number" && isFinite(value) ? value : null;
    } catch (e) {
        return null;
    }
}

function persistMemory() {
    localStorage.setItem("ovid-memory", String(memory));
    memoryIndicator.classList.toggle("active", memory !== 0);
}

$("mplus").addEventListener("click", () => {
    const value = currentValue();
    if (value === null) return;
    memory += value;
    persistMemory();
    showToast("Belleğe eklendi: " + formatNumber(memory));
});

$("mminus").addEventListener("click", () => {
    const value = currentValue();
    if (value === null) return;
    memory -= value;
    persistMemory();
    showToast("Bellekten çıkarıldı: " + formatNumber(memory));
});

$("mr").addEventListener("click", () => {
    pushUndo();
    expression = String(Number(memory.toPrecision(12)));
    updateDisplay();
});

$("mc").addEventListener("click", () => {
    memory = 0;
    persistMemory();
    showToast("Bellek temizlendi");
});

persistMemory();

// =====================================================================
// HISTORY
// =====================================================================

function persistHistory() {
    localStorage.setItem("ovid-history", JSON.stringify(history));
}

function pushHistory(expr, result) {
    history.unshift({ expr, result, at: Date.now() });
    history = history.slice(0, 50);
    persistHistory();
    renderHistory();
}

function renderHistory() {
    historyList.textContent = "";

    if (!history.length) {
        const empty = document.createElement("li");
        empty.className = "panel-empty";
        empty.textContent = "Henüz geçmiş yok";
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
            expression = item.result.replace(/\s/g, "");
            updateDisplay();
            closePanel();
            showToast("Sonuç yüklendi");
        });

        historyList.appendChild(li);
    });
}

$("history-clear").addEventListener("click", () => {
    history = [];
    persistHistory();
    renderHistory();
    showToast("Geçmiş temizlendi");
});

renderHistory();

// =====================================================================
// CONSTANTS (space-native: this is a space calculator, so it knows space)
// =====================================================================

const CONSTANT_LIBRARY = [
    { symbol: "c", name: "Işık hızı", value: 299792458, unit: "m/s" },
    { symbol: "g", name: "Yerçekimi ivmesi", value: 9.80665, unit: "m/s²" },
    { symbol: "G", name: "Evrensel çekim sabiti", value: 6.6743e-11, unit: "m³/kg·s²" },
    { symbol: "h", name: "Planck sabiti", value: 6.62607015e-34, unit: "J·s" },
    { symbol: "Nₐ", name: "Avogadro sayısı", value: 6.02214076e23, unit: "1/mol" },
    { symbol: "AU", name: "Astronomik birim", value: 1.495978707e11, unit: "m" },
    { symbol: "ly", name: "Işık yılı", value: 9.4607304725808e15, unit: "m" },
    { symbol: "pc", name: "Parsek", value: 3.0856775814913673e16, unit: "m" },
    { symbol: "M☉", name: "Güneş kütlesi", value: 1.98892e30, unit: "kg" },
    { symbol: "R⊕", name: "Dünya yarıçapı", value: 6371000, unit: "m" },
    { symbol: "φ", name: "Altın oran", value: 1.618033988749895, unit: "" }
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
        name.textContent = c.name;

        head.append(sym, name);

        const val = document.createElement("span");
        val.className = "constant-value";
        val.textContent = formatNumber(c.value) + (c.unit ? " " + c.unit : "");

        li.append(head, val);

        li.addEventListener("click", () => {
            appendRaw(String(c.value));
            closePanel();
            showToast(c.symbol + " eklendi");
        });

        list.appendChild(li);
    });
}

renderConstants();

// =====================================================================
// UNIT CONVERTER
// =====================================================================

const UNITS = {
    "Uzunluk": {
        mm: 0.001, cm: 0.01, m: 1, km: 1000,
        inç: 0.0254, ft: 0.3048, mil: 1609.344,
        "deniz mili": 1852, AU: 1.495978707e11, "ışık yılı": 9.4607304725808e15
    },
    "Kütle": {
        mg: 1e-6, g: 0.001, kg: 1, ton: 1000,
        ons: 0.028349523125, lb: 0.45359237, "Dünya kütlesi": 5.9722e24
    },
    "Zaman": {
        ms: 0.001, saniye: 1, dakika: 60, saat: 3600,
        gün: 86400, hafta: 604800, yıl: 31557600
    },
    "Hız": {
        "m/s": 1, "km/h": 0.277777778, "mph": 0.44704,
        knot: 0.514444444, "ışık hızı": 299792458
    },
    "Veri": {
        bit: 0.125, bayt: 1, KB: 1024, MB: 1048576,
        GB: 1073741824, TB: 1099511627776
    },
    "Alan": {
        "m²": 1, "km²": 1e6, "cm²": 1e-4,
        hektar: 10000, dönüm: 1000, "ft²": 0.09290304
    },
    "Hacim": {
        ml: 0.001, litre: 1, "m³": 1000,
        galon: 3.785411784, "fincan": 0.2365882365
    },
    "Sıcaklık": null // handled separately: offsets, not ratios
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

Object.keys(UNITS).forEach(cat => {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    categorySelect.appendChild(option);
});

function unitsFor(category) {
    return category === "Sıcaklık" ? TEMP_UNITS : Object.keys(UNITS[category]);
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

    if (category === "Sıcaklık") {
        return fromCelsius(toCelsius(value, fromSelect.value), toSelect.value);
    }

    const table = UNITS[category];
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
    showToast("Sonuç aktarıldı");
});

populateUnits();

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
        showToast("Kopyalandı: " + text);
    } catch (e) {
        showToast("Kopyalanamadı");
    }
});

// =====================================================================
// KEYBOARD
// =====================================================================

document.addEventListener("keydown", (event) => {
    // don't hijack typing inside the converter inputs
    if (event.target.matches("input, select, textarea")) return;

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
    if (key === "%") { applyUnary(v => v / 100); return; }
    if (key === "p") { appendRaw("π"); return; }

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
// BACKGROUND VIDEO: skip the 16 MB download on metered / slow connections
// =====================================================================

(function guardVideo() {
    const conn = navigator.connection;
    if (!conn) return;

    const slow = conn.saveData || /2g/.test(conn.effectiveType || "");
    if (slow) {
        const video = $("bg-video");
        video.removeAttribute("autoplay");
        video.preload = "none";
        video.remove(); // the CSS starfield carries the theme on its own
    }
})();

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
