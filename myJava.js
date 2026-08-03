let expression = "0";
let openParens = 0;
let memory = Number(localStorage.getItem("ovid-memory")) || 0;
let history = JSON.parse(localStorage.getItem("ovid-history") || "[]");

const topDisplay = document.querySelector("#expr-line");
const bottomDisplay = document.querySelector("#result-line");
const memoryIndicator = document.querySelector("#memory-indicator");
const historyPanel = document.querySelector("#history-panel");
const historyToggle = document.querySelector("#history-toggle");
const historyList = document.querySelector("#history-list");
const toastEl = document.querySelector("#toast");

// ================= DISPLAY =================

function updateDisplay() {
    topDisplay.textContent = "Expression";
    bottomDisplay.textContent = expression;
}

function showMessage(message) {
    topDisplay.textContent = message;
    bottomDisplay.textContent = "0";
}

function formatNumber(num) {
    if (Object.is(num, -0)) num = 0;
    const rounded = Number(num.toFixed(10));
    if (rounded !== 0 && (Math.abs(rounded) >= 1e15 || Math.abs(rounded) < 1e-9)) {
        return rounded.toExponential(6);
    }
    return rounded.toString();
}

// ================= TOAST =================

let toastTimer;
function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

// ================= 🌌 SOUND SYSTEM =================

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const ctx = new AudioCtx();

function ensureAudio() {
    if (ctx.state === "suspended") {
        ctx.resume();
    }
}

document.addEventListener("pointerdown", ensureAudio, { once: true });
document.addEventListener("keydown", ensureAudio, { once: true });

// crisp modern UI tick — short sine blip with a fast attack/decay envelope
function playTick(freq = 880) {
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

// ✨ CONFIRM CHIME (=) — bright ascending two-note ping instead of a harsh sweep
function playEqualsSound() {
    ensureAudio();

    const now = ctx.currentTime;
    const notes = [660, 990];

    notes.forEach((freq, i) => {
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

// ================= BUTTON SOUND + PULSE =================

document.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {

        if (btn.id === "equals") {
            playEqualsSound();
        } else if (btn.classList.contains("operator")) {
            playTick(660);
        } else if (btn.classList.contains("sci")) {
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

// ================= NUMBER =================

function trailingSegment() {
    const match = expression.match(/[^+\-*/(]*$/);
    return match ? match[0] : "";
}

function handleNumber(value) {

    if (value === "." && trailingSegment().includes(".")) {
        return;
    }

    if (expression === "0") {
        expression = value === "." ? "0." : value;
    } else {
        expression += value;
    }

    updateDisplay();
}

document.querySelectorAll(".num").forEach(button => {
    button.addEventListener("click", () => {
        handleNumber(button.textContent);
    });
});

// ================= OPERATORS =================

function setOperator(op) {

    if (expression === "0") {
        if (op === "-") expression = "-";
        updateDisplay();
        return;
    }

    const lastChar = expression.slice(-1);
    const isOperator = ["+", "-", "*", "/"].includes(lastChar);

    if (isOperator) {
        if (op === "-" && lastChar !== "-") {
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

document.getElementById("plus").addEventListener("click", () => setOperator("+"));
document.getElementById("minus").addEventListener("click", () => setOperator("-"));
document.getElementById("times").addEventListener("click", () => setOperator("*"));
document.getElementById("divide").addEventListener("click", () => setOperator("/"));

// ================= PARENTHESES =================

function insertParen(type) {

    if (type === "(") {
        if (expression === "0") {
            expression = "(";
        } else if (/[\d)]$/.test(expression)) {
            expression += "*(";
        } else {
            expression += "(";
        }
        openParens++;
    } else if (openParens > 0 && /[\d)]$/.test(expression)) {
        expression += ")";
        openParens--;
    }

    updateDisplay();
}

document.getElementById("paren-open").addEventListener("click", () => insertParen("("));
document.getElementById("paren-close").addEventListener("click", () => insertParen(")"));

// ================= UNARY (√, x², %) =================

function extractTrailingNumber(expr) {
    const numMatch = expr.match(/\d*\.?\d+$/);
    if (!numMatch) return null;

    let start = numMatch.index;
    let numStr = numMatch[0];

    if (start > 0 && expr[start - 1] === "-") {
        const before = expr[start - 2];
        if (before === undefined || "+-*/(".includes(before)) {
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
    if (!isFinite(result)) {
        showMessage("Geçersiz işlem");
        expression = "0";
        openParens = 0;
        return;
    }

    expression = expression.slice(0, info.start) + formatNumber(result) + expression.slice(info.end);
    updateDisplay();
}

document.getElementById("sqrt").addEventListener("click", () => applyUnary(Math.sqrt));
document.getElementById("square").addEventListener("click", () => applyUnary(v => v * v));
document.getElementById("percent").addEventListener("click", () => applyUnary(v => v / 100));

// ================= CALCULATE =================

function sanitizeExpression(expr) {
    if (!/^[0-9+\-*/.() ]+$/.test(expr)) {
        throw new Error("invalid expression");
    }
    return expr;
}

function currentValue() {
    try {
        const value = Function("return " + sanitizeExpression(expression))();
        return typeof value === "number" && isFinite(value) ? value : null;
    } catch (e) {
        return null;
    }
}

function calculate() {
    try {

        const previousExpression = expression;
        const safeExpression = sanitizeExpression(expression);
        let result = Function("return " + safeExpression)();

        if (typeof result !== "number" || !isFinite(result)) {
            showMessage("Sıfıra bölünemez");
            expression = "0";
            openParens = 0;
            return;
        }

        const formatted = formatNumber(result);

        topDisplay.textContent = previousExpression;
        bottomDisplay.textContent = formatted;
        expression = formatted;
        openParens = 0;

        pushHistory(previousExpression, formatted);

    } catch (e) {
        showMessage("Hata");
        expression = "0";
        openParens = 0;
    }
}

// ================= CLEAR =================

function clearAll() {
    expression = "0";
    openParens = 0;
    updateDisplay();
}

document.getElementById("clear").addEventListener("click", clearAll);

// ================= BACKSPACE =================

function backspace() {

    if (expression.length <= 1) {
        expression = "0";
    } else {
        const lastChar = expression.slice(-1);
        if (lastChar === "(") openParens = Math.max(0, openParens - 1);
        if (lastChar === ")") openParens += 1;
        expression = expression.slice(0, -1);
    }

    updateDisplay();
}

document.getElementById("backspace").addEventListener("click", backspace);

// ================= PLUS / MINUS =================

function toggleSign() {

    if (expression === "0") return;

    if (expression.startsWith("-")) {
        expression = expression.slice(1);
    } else {
        expression = "-" + expression;
    }

    updateDisplay();
}

document.getElementById("plusminus").addEventListener("click", toggleSign);

// ================= MEMORY =================

function persistMemory() {
    localStorage.setItem("ovid-memory", String(memory));
}

function updateMemoryIndicator() {
    memoryIndicator.classList.toggle("active", memory !== 0);
}

function memoryAdd() {
    const value = currentValue();
    if (value === null) return;
    memory += value;
    persistMemory();
    updateMemoryIndicator();
    showToast("Belleğe eklendi");
}

function memorySubtract() {
    const value = currentValue();
    if (value === null) return;
    memory -= value;
    persistMemory();
    updateMemoryIndicator();
    showToast("Bellekten çıkarıldı");
}

function memoryRecall() {
    expression = formatNumber(memory);
    openParens = 0;
    updateDisplay();
}

function memoryClear() {
    memory = 0;
    persistMemory();
    updateMemoryIndicator();
    showToast("Bellek temizlendi");
}

document.getElementById("mplus").addEventListener("click", memoryAdd);
document.getElementById("mminus").addEventListener("click", memorySubtract);
document.getElementById("mr").addEventListener("click", memoryRecall);
document.getElementById("mc").addEventListener("click", memoryClear);

updateMemoryIndicator();

// ================= HISTORY =================

function persistHistory() {
    localStorage.setItem("ovid-history", JSON.stringify(history));
}

function pushHistory(expr, result) {
    history.unshift({ expr, result });
    history = history.slice(0, 20);
    persistHistory();
    renderHistory();
}

function renderHistory() {
    historyList.textContent = "";

    if (history.length === 0) {
        const empty = document.createElement("li");
        empty.className = "history-empty";
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
            expression = item.result;
            openParens = 0;
            updateDisplay();
            closeHistory();
        });

        historyList.appendChild(li);
    });
}

function openHistory() {
    historyPanel.classList.add("open");
    historyPanel.setAttribute("aria-hidden", "false");
    historyToggle.setAttribute("aria-expanded", "true");
}

function closeHistory() {
    historyPanel.classList.remove("open");
    historyPanel.setAttribute("aria-hidden", "true");
    historyToggle.setAttribute("aria-expanded", "false");
}

function toggleHistory() {
    if (historyPanel.classList.contains("open")) {
        closeHistory();
    } else {
        openHistory();
    }
}

historyToggle.addEventListener("click", toggleHistory);

document.getElementById("history-clear").addEventListener("click", () => {
    history = [];
    persistHistory();
    renderHistory();
    showToast("Geçmiş temizlendi");
});

renderHistory();

// ================= COPY RESULT =================

bottomDisplay.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(bottomDisplay.textContent);
        showToast("Kopyalandı: " + bottomDisplay.textContent);
    } catch (e) {
        showToast("Kopyalanamadı");
    }
});

// ================= KEYBOARD =================

document.addEventListener("keydown", (event) => {

    const key = event.key;

    if ((key >= "0" && key <= "9") || key === ".") {
        handleNumber(key);
    }

    if (["+", "-", "*", "/"].includes(key)) {
        setOperator(key);
    }

    if (key === "(" || key === ")") {
        insertParen(key);
    }

    if (key === "%") {
        applyUnary(v => v / 100);
    }

    if (key === "Enter" || key === "=") {
        event.preventDefault();
        playEqualsSound();
        screenShake();
        spawnParticles(window.innerWidth / 2, window.innerHeight / 2);
        calculate();
    }

    if (key === "Backspace") {
        backspace();
    }

    if (key === "Escape") {
        if (historyPanel.classList.contains("open")) {
            closeHistory();
        } else {
            clearAll();
        }
    }
});

// ================= 🚀 SPACE OS UPGRADE =================

// screen shake
function screenShake() {
    const calc = document.querySelector(".calculator");
    calc.classList.add("shake");

    setTimeout(() => {
        calc.classList.remove("shake");
    }, 300);
}

// particle explosion
function spawnParticles(x, y) {

    for (let i = 0; i < 12; i++) {

        const p = document.createElement("div");
        p.className = "particle";

        document.body.appendChild(p);

        p.style.left = x + "px";
        p.style.top = y + "px";

        const angle = Math.random() * 360;
        const distance = Math.random() * 90;

        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;

        p.animate([
            { transform: "translate(0,0)", opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }
        ], {
            duration: 650,
            easing: "ease-out"
        });

        setTimeout(() => p.remove(), 650);
    }
}

// override equals (FULL EFFECT)
document.getElementById("equals").addEventListener("click", () => {

    screenShake();

    spawnParticles(
        window.innerWidth / 2,
        window.innerHeight / 2
    );

    calculate();
});

// ambient space hum — fades in smoothly instead of snapping to full volume
function startSpaceHum() {

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
