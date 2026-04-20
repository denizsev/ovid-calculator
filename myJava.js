let expression = "0";

const topDisplay = document.querySelector("#display .top");
const bottomDisplay = document.querySelector("#display .bottom");

// ================= DISPLAY =================

function updateDisplay() {
    topDisplay.textContent = "Expression";
    bottomDisplay.textContent = expression;
}

function showMessage(message) {
    topDisplay.textContent = message;
    bottomDisplay.textContent = "0";
}

// ================= 🌌 SOUND SYSTEM =================

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const ctx = new AudioCtx();

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

// ================= BUTTON SOUND =================

document.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {

        if (btn.id === "equals") {
            playEqualsSound();
        } else {
            playSpaceSound();
        }

        // pulse effect
        btn.classList.remove("pulse");
        void btn.offsetWidth;
        btn.classList.add("pulse");
    });
});

// ================= NUMBER =================

function handleNumber(value) {

    if (expression === "0") {
        expression = value;
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

// ================= CALCULATE =================

function calculate() {
    try {

        const previousExpression = expression;
        let result = Function("return " + expression)();

        if (!isFinite(result)) {
            showMessage("Sifira bolunemez");
            expression = "0";
            return;
        }

        result = Number(result.toFixed(10));

        topDisplay.textContent = previousExpression;
        bottomDisplay.textContent = result;
        expression = String(result);

    } catch (e) {
        showMessage("Error");
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
    } else {
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

// ================= KEYBOARD =================

document.addEventListener("keydown", (event) => {

    const key = event.key;

    if ((key >= "0" && key <= "9") || key === ".") {
        handleNumber(key);
    }

    if (["+", "-", "*", "/"].includes(key)) {
        setOperator(key);
    }

    if (key === "Enter" || key === "=") {
        playEqualsSound();
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

// ambient space hum
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

startSpaceHum();

// button pulse fix
document.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
        btn.classList.remove("pulse");
        void btn.offsetWidth;
        btn.classList.add("pulse");
    });
});