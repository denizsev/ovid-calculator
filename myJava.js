let expression = "0";
let memory = 0;

const topDisplay = document.querySelector("#display .top");
const bottomDisplay = document.querySelector("#display .bottom");
const memoryBadge = document.getElementById("memoryBadge");

// ================= DISPLAY =================

function updateDisplay() {
    topDisplay.textContent = "Expression";
    bottomDisplay.textContent = expression;
}

function showMessage(message) {
    topDisplay.textContent = message;
    bottomDisplay.textContent = "0";
}

function updateMemoryBadge() {
    memoryBadge.classList.toggle("active", memory !== 0);
}

// ================= SAFE EXPRESSION ENGINE =================
// Replaces the previous Function("return " + expr)() eval, which was both
// a code-injection risk and unable to support %, √ or parentheses.

class DivideByZeroError extends Error {}
class MathDomainError extends Error {}

function tokenize(expr) {
    const tokens = [];
    let i = 0;

    while (i < expr.length) {
        const ch = expr[i];

        if (/[0-9.]/.test(ch)) {
            let num = ch;
            i++;
            while (i < expr.length && /[0-9.]/.test(expr[i])) {
                num += expr[i];
                i++;
            }
            tokens.push({ type: "NUM", value: parseFloat(num) });
            continue;
        }

        if (ch === "√") {
            tokens.push({ type: "SQRT" });
            i++;
            continue;
        }

        if ("+-*/%()".includes(ch)) {
            tokens.push({ type: ch });
            i++;
            continue;
        }

        throw new Error("Invalid character");
    }

    return tokens;
}

function parseTokens(tokens) {
    let pos = 0;

    const peek = () => tokens[pos];
    const consume = (type) => {
        const t = tokens[pos];
        if (!t || t.type !== type) throw new Error("Unexpected token");
        pos++;
        return t;
    };

    function parsePrimary() {
        const t = peek();
        if (!t) throw new Error("Unexpected end of expression");

        if (t.type === "NUM") {
            pos++;
            return t.value;
        }
        if (t.type === "-") {
            pos++;
            return -parsePrimary();
        }
        if (t.type === "+") {
            pos++;
            return parsePrimary();
        }
        if (t.type === "(") {
            pos++;
            const value = parseAddSub();
            consume(")");
            return value;
        }
        if (t.type === "SQRT") {
            pos++;
            consume("(");
            const value = parseAddSub();
            consume(")");
            if (value < 0) throw new MathDomainError();
            return Math.sqrt(value);
        }

        throw new Error("Unexpected token");
    }

    function parsePercent() {
        let value = parsePrimary();
        while (peek() && peek().type === "%") {
            pos++;
            value = value / 100;
        }
        return value;
    }

    function parseMulDiv() {
        let value = parsePercent();
        while (peek() && (peek().type === "*" || peek().type === "/")) {
            const op = peek().type;
            pos++;
            const rhs = parsePercent();
            if (op === "*") {
                value *= rhs;
            } else {
                if (rhs === 0) throw new DivideByZeroError();
                value /= rhs;
            }
        }
        return value;
    }

    function parseAddSub() {
        let value = parseMulDiv();
        while (peek() && (peek().type === "+" || peek().type === "-")) {
            const op = peek().type;
            pos++;
            const rhs = parseMulDiv();
            value = op === "+" ? value + rhs : value - rhs;
        }
        return value;
    }

    const result = parseAddSub();
    if (pos !== tokens.length) throw new Error("Unexpected token");
    return result;
}

function evaluateExpression(expr) {
    const opens = (expr.match(/\(/g) || []).length;
    const closes = (expr.match(/\)/g) || []).length;
    const balanced = expr + ")".repeat(Math.max(0, opens - closes));

    return parseTokens(tokenize(balanced));
}

function trimNumber(n) {
    return Number(n.toFixed(10)).toString();
}

function currentValue() {
    try {
        const val = evaluateExpression(expression);
        return isFinite(val) ? val : 0;
    } catch (e) {
        return 0;
    }
}

// ================= 🌌 SOUND SYSTEM =================

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const ctx = new AudioCtx();

function ensureAudio() {
    if (ctx.state === "suspended") {
        ctx.resume();
    }
}

// soft space click
function playSpaceSound() {

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(120, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.25);

    gain1.gain.setValueAtTime(0.05, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(700, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(250, ctx.currentTime + 0.2);

    gain2.gain.setValueAtTime(0.03, ctx.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc1.start();
    osc1.stop(ctx.currentTime + 0.3);

    osc2.start();
    osc2.stop(ctx.currentTime + 0.25);
}

// ⭐ WARP SOUND (=)
function playEqualsSound() {

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";

    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.5);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.5);
}

function startSpaceHum() {

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 55;

    gain.gain.value = 0.012;

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
}

let humStarted = false;
document.addEventListener("pointerdown", () => {
    ensureAudio();
    if (!humStarted) {
        startSpaceHum();
        humStarted = true;
    }
}, { once: true });

// ================= BUTTON SOUND + PULSE =================

document.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {

        ensureAudio();

        if (btn.id === "equals") {
            playEqualsSound();
        } else {
            playSpaceSound();
        }

        btn.classList.remove("pulse");
        void btn.offsetWidth;
        btn.classList.add("pulse");
    });
});

// ================= NUMBER =================

function getLastOperand() {
    const match = expression.match(/[0-9.]*$/);
    return match ? match[0] : "";
}

function handleNumber(value) {

    const lastChar = expression.slice(-1);

    if (value === ".") {
        if (getLastOperand().includes(".")) return;
        if (expression === "0") {
            expression = "0.";
            updateDisplay();
            return;
        }
        if (getLastOperand() === "") {
            expression += "0.";
            updateDisplay();
            return;
        }
    }

    if (expression === "0") {
        expression = value;
    } else if (lastChar === ")") {
        expression += "*" + value;
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

    const lastChar = expression.slice(-1);

    if (lastChar === "(" && op !== "-") return;

    if (["+", "-", "*", "/"].includes(lastChar)) {
        expression = expression.slice(0, -1) + op;
    } else {
        expression += op;
    }

    updateDisplay();
}

document.getElementById("plus").addEventListener("click", () => setOperator("+"));
document.getElementById("minus").addEventListener("click", () => setOperator("-"));
document.getElementById("times").addEventListener("click", () => setOperator("*"));
document.getElementById("divide").addEventListener("click", () => setOperator("/"));

// ================= PARENTHESES / % / √ =================

function insertOpenParen() {
    if (expression === "0") {
        expression = "(";
    } else {
        const lastChar = expression.slice(-1);
        expression += /[0-9)]/.test(lastChar) ? "*(" : "(";
    }
    updateDisplay();
}

function insertCloseParen() {
    const opens = (expression.match(/\(/g) || []).length;
    const closes = (expression.match(/\)/g) || []).length;
    const lastChar = expression.slice(-1);

    if (opens > closes && /[0-9)]/.test(lastChar)) {
        expression += ")";
        updateDisplay();
    }
}

function insertPercent() {
    const lastChar = expression.slice(-1);
    if (/[0-9)]/.test(lastChar)) {
        expression += "%";
        updateDisplay();
    }
}

function insertSqrt() {
    if (expression === "0") {
        expression = "√(";
    } else {
        const lastChar = expression.slice(-1);
        expression += /[0-9)]/.test(lastChar) ? "*√(" : "√(";
    }
    updateDisplay();
}

document.getElementById("openParen").addEventListener("click", insertOpenParen);
document.getElementById("closeParen").addEventListener("click", insertCloseParen);
document.getElementById("percent").addEventListener("click", insertPercent);
document.getElementById("sqrt").addEventListener("click", insertSqrt);

// ================= MEMORY =================

function insertMemoryValue() {
    const memStr = trimNumber(memory);
    const lastChar = expression.slice(-1);

    if (expression === "0" || ["+", "-", "*", "/", "(", "%"].includes(lastChar)) {
        expression = expression === "0" ? memStr : expression + memStr;
    } else {
        expression = memStr;
    }
    updateDisplay();
}

document.getElementById("memClear").addEventListener("click", () => {
    memory = 0;
    updateMemoryBadge();
});

document.getElementById("memRecall").addEventListener("click", insertMemoryValue);

document.getElementById("memAdd").addEventListener("click", () => {
    memory += currentValue();
    updateMemoryBadge();
});

document.getElementById("memSubtract").addEventListener("click", () => {
    memory -= currentValue();
    updateMemoryBadge();
});

// ================= CALCULATE =================

function calculate() {
    try {

        const previousExpression = expression;
        let result = evaluateExpression(expression);
        result = Number(result.toFixed(10));

        topDisplay.textContent = previousExpression;
        bottomDisplay.textContent = String(result);
        expression = String(result);

    } catch (e) {

        if (e instanceof DivideByZeroError) {
            showMessage("Sıfıra bölünemez");
        } else if (e instanceof MathDomainError) {
            showMessage("Tanımsız");
        } else {
            showMessage("Hata");
        }

        expression = "0";
    }
}

// ================= CLEAR =================

function clearAll() {
    expression = "0";
    updateDisplay();
}

document.getElementById("clear").addEventListener("click", clearAll);

// ================= BACKSPACE =================

function backspace() {

    if (expression.length <= 1) {
        expression = "0";
    } else if (expression.endsWith("√(")) {
        expression = expression.slice(0, -2) || "0";
    } else {
        expression = expression.slice(0, -1);
    }

    if (expression === "") expression = "0";

    updateDisplay();
}

document.getElementById("backspace").addEventListener("click", backspace);

// ================= PLUS / MINUS =================

function toggleSign() {

    if (expression === "0") return;

    // Only toggle when the whole expression is a plain number, so we never
    // corrupt a multi-term expression by guessing which operand to negate.
    if (!/^-?[0-9.]+$/.test(expression)) return;

    if (expression.startsWith("-")) {
        expression = expression.slice(1);
    } else {
        expression = "-" + expression;
    }

    updateDisplay();
}

document.getElementById("plusminus").addEventListener("click", toggleSign);

// ================= KEYBOARD =================

document.addEventListener("keydown", (event) => {

    const key = event.key;

    if ((key >= "0" && key <= "9") || key === ".") {
        handleNumber(key);
    }

    if (["+", "-", "*", "/"].includes(key)) {
        setOperator(key);
    }

    if (key === "(") insertOpenParen();
    if (key === ")") insertCloseParen();
    if (key === "%") insertPercent();

    if (key === "Enter" || key === "=") {
        event.preventDefault();
        ensureAudio();
        playEqualsSound();
        screenShake();
        spawnParticles(window.innerWidth / 2, window.innerHeight / 2);
        calculate();
    }

    if (key === "Backspace") {
        backspace();
    }

    if (key === "Escape") {
        clearAll();
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
