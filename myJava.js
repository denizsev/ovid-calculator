/* =====================================================================
   OVID CALCULATOR
   Expression engine: tokenizer -> shunting-yard -> RPN evaluation.
   Deliberately not eval()/Function(): needed for functions, constants,
   factorial and implicit multiplication, and it keeps input untrusted.
   ===================================================================== */

// =====================================================================
// STORAGE — Safari private mode and full quotas throw on setItem, which
// used to take the whole app down. Persistence is a nicety, not a
// requirement, so failures degrade to in-memory only.
// =====================================================================

const memoryStore = {};

function storeGet(key) {
    try {
        const value = window.localStorage.getItem(key);
        return value === null ? (memoryStore[key] ?? null) : value;
    } catch (e) {
        return memoryStore[key] ?? null;
    }
}

function storeSet(key, value) {
    memoryStore[key] = value;
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch (e) {
        return false;
    }
}

function storeRemove(key) {
    delete memoryStore[key];
    try {
        window.localStorage.removeItem(key);
    } catch (e) {
        /* nothing to clean up */
    }
}

// ================= STATE =================

let expression = "0";
let lastResult = null;
let angleMode = storeGet("ovid-angle") || "DEG";
let soundOn = storeGet("ovid-sound") !== "off";
let stepMode = storeGet("ovid-step") === "on";
let fractionMode = storeGet("ovid-fraction") === "on";
let secondMode = false;
let memory = Number(storeGet("ovid-memory")) || 0;
let history = JSON.parse(storeGet("ovid-history") || "[]");

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
// QUANTITY — a value that carries its uncertainty and its dimensions.
// This is what makes "5.2±0.1 * 3" and "5 km + 300 m" possible.
// =====================================================================

// =====================================================================
// EXACT RATIONALS
// Binary floating point cannot hold 1/3 or even 0.1, so errors creep in
// and surface later: (0.1+0.2)*3-0.9 lands on 1.1e-16 instead of 0.
// Alongside every float we therefore carry an exact numerator/denominator
// pair (BigInt) whenever the value is still provably rational. When an
// operation leaves the rationals (sin, ln, π, a measured ±), the exact
// form is dropped and the float stands alone — honestly inexact.
// =====================================================================

const RAT_LIMIT = 10n ** 40n; // beyond this an "exact" fraction is unreadable anyway

function ratGcd(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b) { [a, b] = [b, a % b]; }
    return a;
}

function rat(n, d = 1n) {
    if (d === 0n) return null;

    if (d < 0n) { n = -n; d = -d; }

    const g = ratGcd(n, d) || 1n;
    n /= g;
    d /= g;

    const magnitude = (n < 0n ? -n : n) > d ? (n < 0n ? -n : n) : d;
    if (magnitude > RAT_LIMIT) return null;

    return { n, d };
}

/* Parses the digits the user actually typed, not the float they became:
   "0.1" must become 1/10, never the binary approximation of 0.1. */
function ratFromDecimal(text) {
    const match = String(text).trim().match(/^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
    if (!match) return null;

    const [, sign, intPart = "", fracPart = "", expPart] = match;
    if (!intPart && !fracPart) return null;

    let n = BigInt((intPart || "0") + (fracPart || ""));
    let d = 10n ** BigInt((fracPart || "").length);

    const exp = Number(expPart || 0);
    if (exp > 0) n *= 10n ** BigInt(exp);
    if (exp < 0) d *= 10n ** BigInt(-exp);

    if (sign === "-") n = -n;

    return rat(n, d);
}

const ratFromNumber = value => Number.isFinite(value) ? ratFromDecimal(value.toString()) : null;

const ratAdd = (a, b) => (a && b) ? rat(a.n * b.d + b.n * a.d, a.d * b.d) : null;
const ratSub = (a, b) => (a && b) ? rat(a.n * b.d - b.n * a.d, a.d * b.d) : null;
const ratMul = (a, b) => (a && b) ? rat(a.n * b.n, a.d * b.d) : null;
const ratDiv = (a, b) => (a && b && b.n !== 0n) ? rat(a.n * b.d, a.d * b.n) : null;
const ratNeg = a => a ? { n: -a.n, d: a.d } : null;

function ratPow(a, exp) {
    if (!a || !Number.isInteger(exp) || Math.abs(exp) > 64) return null;
    if (exp === 0) return rat(1n, 1n);

    const e = BigInt(Math.abs(exp));
    const powered = rat(a.n ** e, a.d ** e);
    if (!powered) return null;

    return exp > 0 ? powered : ratDiv(rat(1n, 1n), powered);
}

const ratToNumber = a => a ? Number(a.n) / Number(a.d) : null;
const ratIsWhole = a => a && a.d === 1n;

/* Dimension vector: [length, mass, time, data]. Everything is stored in
   base units (m, kg, s, byte); `unit` only decides how it is displayed. */
const DIMLESS = [0, 0, 0, 0];

const sameDim = (a, b) => a.every((v, i) => v === b[i]);
const isDimless = d => d.every(v => v === 0);
const addDim = (a, b) => a.map((v, i) => v + b[i]);
const subDim = (a, b) => a.map((v, i) => v - b[i]);
const scaleDim = (a, n) => a.map(v => v * n);

const BASE_LABELS = ["m", "kg", "s", "B"];

function dimLabel(dim) {
    const top = [];
    const bottom = [];

    dim.forEach((exp, i) => {
        if (exp === 0) return;
        const label = BASE_LABELS[i];
        const abs = Math.abs(exp);
        const term = abs === 1 ? label : label + "^" + abs;
        (exp > 0 ? top : bottom).push(term);
    });

    if (!top.length && !bottom.length) return "";
    const numerator = top.length ? top.join("·") : "1";
    return bottom.length ? numerator + "/" + bottom.join("·") : numerator;
}

class Quantity {
    constructor(value, uncertainty = 0, dim = DIMLESS, unit = null, exact = null) {
        this.v = value;
        this.u = Math.abs(uncertainty);
        this.dim = dim;
        this.unit = unit;   // { label, factor, rFactor } — display preference only
        // an exact rational is meaningless once a measurement error is attached
        this.r = this.u > 0 ? null : exact;
    }
}

const scalar = n => new Quantity(n, 0, DIMLESS, null, ratFromNumber(n));

function requireDimless(q, what) {
    if (!isDimless(q.dim)) {
        throw new Error(what + " birimsiz olmalı");
    }
}

// ---- unit-aware arithmetic with Gaussian error propagation ----

function qAdd(a, b, sign = 1) {
    if (!sameDim(a.dim, b.dim)) throw new Error("Birimler uyuşmuyor");
    return new Quantity(
        a.v + sign * b.v,
        Math.hypot(a.u, b.u),
        a.dim,
        a.unit || b.unit,
        sign > 0 ? ratAdd(a.r, b.r) : ratSub(a.r, b.r)
    );
}

function parsePower(label) {
    const match = label.match(/^([^^]+)\^(-?\d+)$/);
    return match
        ? { base: match[1], exp: Number(match[2]) }
        : { base: label, exp: 1 };
}

function powerLabel(base, exp) {
    if (exp === 0) return null;
    if (exp === 1) return base;
    return base + "^" + exp;
}

/* Keeps m·m readable as m², and lets km/km cancel back to a plain number */
function combineUnit(a, b, op) {
    if (!a.unit && !b.unit) return null;
    if (a.unit && !b.unit) return a.unit;
    if (!a.unit && b.unit) {
        return op === "*"
            ? b.unit
            : {
                label: "1/" + b.unit.label,
                factor: 1 / b.unit.factor,
                rFactor: ratDiv(rat(1n, 1n), b.unit.rFactor)
            };
    }

    const left = parsePower(a.unit.label);
    const right = parsePower(b.unit.label);

    const factor = op === "*"
        ? a.unit.factor * b.unit.factor
        : a.unit.factor / b.unit.factor;

    const rFactor = op === "*"
        ? ratMul(a.unit.rFactor, b.unit.rFactor)
        : ratDiv(a.unit.rFactor, b.unit.rFactor);

    if (left.base === right.base) {
        const exp = op === "*" ? left.exp + right.exp : left.exp - right.exp;
        const label = powerLabel(left.base, exp);
        return label ? { label, factor, rFactor } : null;
    }

    const label = op === "*"
        ? a.unit.label + "·" + b.unit.label
        : a.unit.label + "/" + b.unit.label;

    return { label, factor, rFactor };
}

function qMul(a, b) {
    // exact form: avoids dividing by zero-valued operands
    return new Quantity(
        a.v * b.v,
        Math.hypot(b.v * a.u, a.v * b.u),
        addDim(a.dim, b.dim),
        combineUnit(a, b, "*"),
        ratMul(a.r, b.r)
    );
}

function qDiv(a, b) {
    return new Quantity(
        a.v / b.v,
        Math.hypot(a.u / b.v, (a.v * b.u) / (b.v * b.v)),
        subDim(a.dim, b.dim),
        combineUnit(a, b, "/"),
        ratDiv(a.r, b.r)
    );
}

function qPow(a, b) {
    requireDimless(b, "Üs");

    if (!isDimless(a.dim) && !Number.isInteger(b.v)) {
        throw new Error("Birimli değerin üssü tam sayı olmalı");
    }

    const value = Math.pow(a.v, b.v);
    const dBase = b.v * Math.pow(a.v, b.v - 1) * a.u;
    const dExp = a.v > 0 ? value * Math.log(a.v) * b.u : 0;

    const unit = a.unit && Number.isInteger(b.v)
        ? {
            label: b.v === 1 ? a.unit.label : a.unit.label + "^" + b.v,
            factor: Math.pow(a.unit.factor, b.v),
            rFactor: ratPow(a.unit.rFactor, b.v)
        }
        : null;

    const exact = (b.r && ratIsWhole(b.r)) ? ratPow(a.r, b.v) : null;

    return new Quantity(value, Math.hypot(dBase, dExp), scaleDim(a.dim, b.v), unit, exact);
}

/* JavaScript's % is a remainder, not a modulo: -7 % 3 is -1, while the
   mathematical convention gives 2. Follow the sign of the divisor, which is
   what every number-theory text (and Python) does. */
function qMod(a, b) {
    if (!sameDim(a.dim, b.dim)) throw new Error("Birimler uyuşmuyor");
    if (b.v === 0) throw new Error("Sıfıra göre mod alınamaz");

    const value = ((a.v % b.v) + b.v) % b.v;

    // uncertainty is discontinuous across the wrap, so it is not carried
    return new Quantity(value, 0, a.dim, a.unit);
}

function qNeg(a) {
    return new Quantity(-a.v, a.u, a.dim, a.unit, ratNeg(a.r));
}

function factorial(n) {
    if (n < 0 || !Number.isInteger(n)) throw new Error("Faktöriyel yalnızca pozitif tam sayılar için");
    if (n > 170) return Infinity;
    let acc = 1;
    for (let i = 2; i <= n; i++) acc *= i;
    return acc;
}

function qFactorial(a) {
    requireDimless(a, "Faktöriyel girdisi");

    const value = factorial(a.v);

    // factorials are integers, so keep them exact well past float precision
    let exact = null;
    if (Number.isInteger(a.v) && a.v >= 0 && a.v <= 40) {
        let acc = 1n;
        for (let i = 2n; i <= BigInt(a.v); i++) acc *= i;
        exact = rat(acc, 1n);
    }

    return new Quantity(value, 0, DIMLESS, null, exact);
}

// =====================================================================
// FUNCTIONS — each carries its derivative so uncertainty can propagate
// =====================================================================

function radPerUnit() {
    return angleMode === "DEG" ? Math.PI / 180 : 1;
}

/* `domain` returns an error message when the input is outside the function's
   domain. Without it these silently produced NaN and the user was told
   "Tanımsız sonuç" with no idea which argument was at fault. */
const FUNCTIONS = {
    sin: { f: x => Math.sin(toRadians(x)), df: x => Math.cos(toRadians(x)) * radPerUnit() },
    cos: { f: x => Math.cos(toRadians(x)), df: x => -Math.sin(toRadians(x)) * radPerUnit() },
    tan: {
        f: x => Math.tan(toRadians(x)),
        df: x => radPerUnit() / Math.pow(Math.cos(toRadians(x)), 2),
        // cos(90°) is not exactly 0 in binary, so tan(90) returned 1.6e16
        domain: x => Math.abs(Math.cos(toRadians(x))) < 1e-12
            ? "tan burada tanımsız (90° + k·180°)"
            : null
    },
    asin: {
        f: x => fromRadians(Math.asin(x)),
        df: x => 1 / (Math.sqrt(1 - x * x) * radPerUnit()),
        domain: x => (x < -1 || x > 1) ? "asin girdisi −1 ile 1 arasında olmalı" : null
    },
    acos: {
        f: x => fromRadians(Math.acos(x)),
        df: x => -1 / (Math.sqrt(1 - x * x) * radPerUnit()),
        domain: x => (x < -1 || x > 1) ? "acos girdisi −1 ile 1 arasında olmalı" : null
    },
    atan: { f: x => fromRadians(Math.atan(x)), df: x => 1 / ((1 + x * x) * radPerUnit()) },
    ln: {
        f: Math.log,
        df: x => 1 / x,
        domain: x => x < 0 ? "ln negatif sayı için tanımsız" : (x === 0 ? "ln(0) tanımsız" : null)
    },
    log: {
        f: Math.log10,
        df: x => 1 / (x * Math.LN10),
        domain: x => x < 0 ? "log negatif sayı için tanımsız" : (x === 0 ? "log(0) tanımsız" : null)
    },
    exp: { f: Math.exp, df: Math.exp },
    sqrt: {
        f: Math.sqrt,
        df: x => 1 / (2 * Math.sqrt(x)),
        domain: x => x < 0 ? "Negatif sayının karekökü alınamaz" : null
    },
    abs: { f: Math.abs, df: x => Math.sign(x) }
};

/* An exact square root stays exact: sqrt(4/9) is 2/3, not 0.666… */
function ratSqrt(r) {
    if (!r || r.n < 0n) return null;

    const isqrt = (value) => {
        if (value < 2n) return value;
        let x = value, y = (x + 1n) / 2n;
        while (y < x) { x = y; y = (x + value / x) / 2n; }
        return x;
    };

    const rootN = isqrt(r.n);
    const rootD = isqrt(r.d);

    return (rootN * rootN === r.n && rootD * rootD === r.d) ? rat(rootN, rootD) : null;
}

function qApplyFunction(name, a) {
    const fn = FUNCTIONS[name];

    // sqrt is the one function that is meaningful on a dimensioned value
    if (name === "sqrt" && !isDimless(a.dim)) {
        if (a.v < 0) throw new Error("Negatif sayının karekökü alınamaz");
        if (a.dim.some(d => d % 2 !== 0)) throw new Error("Bu birimin karekökü alınamaz");
        return new Quantity(
            Math.sqrt(a.v),
            a.u / (2 * Math.sqrt(a.v)),
            scaleDim(a.dim, 0.5)
        );
    }

    requireDimless(a, name + " girdisi");

    if (fn.domain) {
        const problem = fn.domain(a.v);
        if (problem) throw new Error(problem);
    }

    const exact = name === "sqrt" ? ratSqrt(a.r) : null;

    return new Quantity(fn.f(a.v), Math.abs(fn.df(a.v)) * a.u, DIMLESS, null, exact);
}

// =====================================================================
// UNITS
// =====================================================================

const UNITS = {
    // length
    m: { f: 1, d: [1, 0, 0, 0] },
    km: { f: 1000, d: [1, 0, 0, 0] },
    cm: { f: 0.01, d: [1, 0, 0, 0] },
    mm: { f: 0.001, d: [1, 0, 0, 0] },
    mi: { f: 1609.344, d: [1, 0, 0, 0] },
    ft: { f: 0.3048, d: [1, 0, 0, 0] },
    AU: { f: 1.495978707e11, d: [1, 0, 0, 0] },
    ly: { f: 9.4607304725808e15, d: [1, 0, 0, 0] },
    pc: { f: 3.0856775814913673e16, d: [1, 0, 0, 0] },

    // mass
    kg: { f: 1, d: [0, 1, 0, 0] },
    g: { f: 0.001, d: [0, 1, 0, 0] },
    mg: { f: 1e-6, d: [0, 1, 0, 0] },
    ton: { f: 1000, d: [0, 1, 0, 0] },
    lb: { f: 0.45359237, d: [0, 1, 0, 0] },

    // time
    s: { f: 1, d: [0, 0, 1, 0] },
    ms: { f: 0.001, d: [0, 0, 1, 0] },
    dk: { f: 60, d: [0, 0, 1, 0] },
    min: { f: 60, d: [0, 0, 1, 0] },
    sa: { f: 3600, d: [0, 0, 1, 0] },
    h: { f: 3600, d: [0, 0, 1, 0] },
    gün: { f: 86400, d: [0, 0, 1, 0] },
    yıl: { f: 31557600, d: [0, 0, 1, 0] },

    // data
    B: { f: 1, d: [0, 0, 0, 1] },
    KB: { f: 1024, d: [0, 0, 0, 1] },
    MB: { f: 1048576, d: [0, 0, 0, 1] },
    GB: { f: 1073741824, d: [0, 0, 0, 1] },
    TB: { f: 1099511627776, d: [0, 0, 0, 1] }
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

const IDENT_CHAR = /[a-zA-ZπüığöçşİÜĞÖÇŞ]/;

function tokenize(input) {
    const tokens = [];
    let i = 0;

    const skipSpace = () => { while (i < input.length && input[i] === " ") i++; };

    // returns the raw text: the exact digits matter, parseFloat already rounds
    const readNumber = () => {
        let num = "";
        while (i < input.length && /[0-9.]/.test(input[i])) num += input[i++];
        if ((num.match(/\./g) || []).length > 1) throw new Error("Geçersiz sayı");
        return num;
    };

    const readIdent = () => {
        let name = "";
        while (i < input.length && IDENT_CHAR.test(input[i])) name += input[i++];
        return name;
    };

    while (i < input.length) {
        const ch = input[i];

        if (ch === " ") { i++; continue; }

        // number, optionally "±uncertainty" and/or a unit suffix
        if (/[0-9.]/.test(ch)) {
            const numStart = i;
            const raw = readNumber();
            const numEnd = i;
            let uncertRaw = "0";
            let unit = null;

            let save = i;
            skipSpace();
            if (input[i] === "±") {
                i++;
                skipSpace();
                if (!/[0-9.]/.test(input[i] || "")) throw new Error("± sonrası sayı bekleniyor");
                uncertRaw = readNumber();
            } else {
                i = save;
            }

            save = i;
            skipSpace();
            const name = readIdent();
            if (name && UNITS[name]) {
                unit = name;
            } else {
                i = save;
            }

            tokens.push({
                type: "number",
                raw,
                value: parseFloat(raw),
                uncert: parseFloat(uncertRaw),
                uncertRaw: uncertRaw === "0" ? null : uncertRaw,
                unit,
                // where the digits sit in the source, so a slider can rewrite them
                numStart,
                numEnd
            });
            continue;
        }

        // named tokens: functions, mod, constants
        if (IDENT_CHAR.test(ch)) {
            const name = readIdent();

            if (FUNCTIONS[name]) {
                tokens.push({ type: "function", value: name });
            } else if (name === "mod") {
                tokens.push({ type: "operator", value: "mod" });
            } else if (CONSTANTS[name] !== undefined) {
                // π and e are irrational: no exact rational form exists
                tokens.push({ type: "number", value: CONSTANTS[name], uncert: 0, unit: null, raw: null });
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

// =====================================================================
// AST — built from the RPN so the expression can be reduced one visible
// step at a time (warp mode) instead of collapsing to a single answer.
// =====================================================================

function quantityFromToken(token) {
    // built from the typed digits, so "0.1" is exactly 1/10 and not the float
    const exact = token.raw ? ratFromDecimal(token.raw) : null;

    if (!token.unit) {
        return new Quantity(token.value, token.uncert || 0, DIMLESS, null, exact);
    }

    const unit = UNITS[token.unit];
    const rFactor = ratFromNumber(unit.f);

    return new Quantity(
        token.value * unit.f,
        (token.uncert || 0) * unit.f,
        unit.d,
        { label: token.unit, factor: unit.f, rFactor },
        ratMul(exact, rFactor)
    );
}

function buildAST(rpn) {
    const stack = [];
    const pop = () => {
        if (!stack.length) throw new Error("Eksik ifade");
        return stack.pop();
    };

    for (const token of rpn) {
        switch (token.type) {
            case "number":
                stack.push({ type: "num", q: quantityFromToken(token) });
                break;
            case "unary":
                stack.push({ type: "neg", arg: pop() });
                break;
            case "postfix":
                stack.push({ type: "fact", arg: pop() });
                break;
            case "function":
                stack.push({ type: "fn", name: token.value, arg: pop() });
                break;
            case "operator": {
                const right = pop();
                const left = pop();
                stack.push({ type: "op", op: token.value, left, right });
                break;
            }
        }
    }

    if (stack.length !== 1) throw new Error("Eksik ifade");
    return stack[0];
}

function evalNode(node) {
    switch (node.type) {
        case "num": return node.q;
        case "neg": return qNeg(evalNode(node.arg));
        case "fact": return qFactorial(evalNode(node.arg));
        case "fn": return qApplyFunction(node.name, evalNode(node.arg));
        case "op": {
            const a = evalNode(node.left);
            const b = evalNode(node.right);
            switch (node.op) {
                case "+": return qAdd(a, b, 1);
                case "-": return qAdd(a, b, -1);
                case "*": return qMul(a, b);
                case "/": return qDiv(a, b);
                case "mod": return qMod(a, b);
                case "^": return qPow(a, b);
            }
        }
    }
    throw new Error("Eksik ifade");
}

/* Reduce the single next operation, leftmost-innermost. Because the AST
   already encodes precedence, post-order traversal yields exactly the
   order a human would evaluate in. */
function reduceOnce(node) {
    if (node.type === "num") return { node, changed: false };

    if (node.type === "op") {
        const left = reduceOnce(node.left);
        if (left.changed) return { node: { ...node, left: left.node }, changed: true };

        const right = reduceOnce(node.right);
        if (right.changed) return { node: { ...node, right: right.node }, changed: true };

        return { node: { type: "num", q: evalNode(node) }, changed: true };
    }

    const inner = reduceOnce(node.arg);
    if (inner.changed) return { node: { ...node, arg: inner.node }, changed: true };

    return { node: { type: "num", q: evalNode(node) }, changed: true };
}

const OP_SYMBOLS = { "+": "+", "-": "−", "*": "×", "/": "÷", "^": "^", "mod": "mod" };

function renderAST(node, parentPrec = 0) {
    switch (node.type) {
        case "num": return formatQuantity(node.q);
        case "neg": return "−" + renderAST(node.arg, UNARY_PREC);
        case "fact": return renderAST(node.arg, 5) + "!";
        case "fn": return node.name + "(" + renderAST(node.arg, 0) + ")";
        case "op": {
            const prec = OPERATORS[node.op].prec;
            const rightAssoc = OPERATORS[node.op].assoc === "right";

            const text = renderAST(node.left, rightAssoc ? prec + 1 : prec) +
                " " + OP_SYMBOLS[node.op] + " " +
                renderAST(node.right, rightAssoc ? prec : prec + 1);

            return prec < parentPrec ? "(" + text + ")" : text;
        }
    }
    return "";
}

function parse(input) {
    // auto-close parentheses so the live preview works while typing
    const open = (input.match(/\(/g) || []).length;
    const close = (input.match(/\)/g) || []).length;
    const balanced = input + ")".repeat(Math.max(0, open - close));

    return buildAST(toRPN(normalize(tokenize(balanced))));
}

function evaluate(input) {
    return evalNode(parse(input));
}

/* The visible steps of an evaluation, e.g. 2+3×4 -> 2+12 -> 14 */
function evaluationSteps(input) {
    let node = parse(input);
    const steps = [renderAST(node)];

    for (let guard = 0; guard < 60; guard++) {
        const next = reduceOnce(node);
        if (!next.changed) break;
        node = next.node;
        steps.push(renderAST(node));
        if (node.type === "num") break;
    }

    return steps;
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

/* Uncertainty is only meaningful to a couple of significant digits, and the
   value should not be quoted more precisely than its own error bar. */
function formatUncertain(value, uncertainty) {
    if (!(uncertainty > 0)) return formatNumber(value);

    const magnitude = Math.floor(Math.log10(uncertainty));
    const decimals = Math.min(12, Math.max(0, -magnitude + 1));

    return formatNumber(Number(value.toFixed(decimals))) +
        " ± " + formatNumber(Number(uncertainty.toFixed(decimals)));
}

// fractions longer than this are noise, not insight
const FRACTION_READABLE = 10n ** 7n;

function formatQuantity(q) {
    let value = q.v;
    let uncertainty = q.u;
    let label = "";

    // the exact form, expressed in the unit the user is looking at
    let exact = q.r;

    if (q.unit) {
        value /= q.unit.factor;
        uncertainty /= q.unit.factor;
        label = " " + q.unit.label;
        exact = q.unit.rFactor ? ratDiv(exact, q.unit.rFactor) : null;
    } else if (!isDimless(q.dim)) {
        label = " " + dimLabel(q.dim);
    }

    if (exact) {
        // exact beats float even in decimal mode: this is what turns
        // (0.1+0.2)*3-0.9 from 1.11e-16 into a clean 0
        value = ratToNumber(exact);

        const readable = exact.d > 1n && exact.d < FRACTION_READABLE &&
            (exact.n < 0n ? -exact.n : exact.n) < FRACTION_READABLE;

        if (fractionMode && readable) {
            return exact.n + "/" + exact.d + label;
        }
    }

    return formatUncertain(value, uncertainty) + label;
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
            chip.title = "Kaydırıcıya çevirmek için tıkla";
            chip.setAttribute("aria-label", label + " — kaydırıcı aç");

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
        showToast("Önce bir sayı girin");
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
        showMessage("Geçersiz işlem");
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

    announce(previous + " eşittir " + formatted);

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
        showMessage(e.message || "Hata");
        playErrorSound();
        expression = "0";
        return;
    }

    if (!result || Number.isNaN(result.v)) {
        showMessage("Tanımsız sonuç");
        playErrorSound();
        expression = "0";
        return;
    }

    if (!isFinite(result.v)) {
        showMessage("Sıfıra bölünemez");
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
    showToast("Açı birimi: " + angleMode);
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
    showToast(soundOn ? "Ses açık" : "Ses kapalı");
});

setSound(soundOn);

/* Answers the most common accessibility complaint about calculators:
   "the buttons and text are too small". Cycles through three sizes. */
const SIZE_STEPS = ["normal", "buyuk", "cokbuyuk"];
const SIZE_LABELS = { normal: "A", buyuk: "A+", cokbuyuk: "A++" };
const SIZE_TOASTS = { normal: "Normal boyut", buyuk: "Büyük boyut", cokbuyuk: "Çok büyük boyut" };

let sizeMode = storeGet("ovid-size") || "normal";

function setSizeMode(mode) {
    sizeMode = SIZE_STEPS.includes(mode) ? mode : "normal";
    storeSet("ovid-size", sizeMode);

    document.body.classList.remove("size-buyuk", "size-cokbuyuk");
    if (sizeMode !== "normal") document.body.classList.add("size-" + sizeMode);

    $("size-toggle").textContent = SIZE_LABELS[sizeMode];
}

$("size-toggle").addEventListener("click", () => {
    const next = SIZE_STEPS[(SIZE_STEPS.indexOf(sizeMode) + 1) % SIZE_STEPS.length];
    setSizeMode(next);
    showToast(SIZE_TOASTS[sizeMode]);
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
    showToast(stepMode ? "Warp modu açık — adım adım" : "Warp modu kapalı");
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
    showToast(fractionMode ? "Kesir modu açık — tam değer" : "Kesir modu kapalı — ondalık");
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
            expression = item.reusable || item.result.replace(/\s/g, "");
            updateDisplay();
            closePanel();
            showToast("Sonuç yüklendi");
        });

        historyList.appendChild(li);
    });
}

// destructive and irreversible, so it asks first
$("history-clear").addEventListener("click", () => {
    if (!history.length) {
        showToast("Geçmiş zaten boş");
        return;
    }
    if (!confirm("Tüm hesap geçmişi silinecek. Emin misin?")) return;

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
// UNIT PALETTE — click a unit to append it to the current number
// =====================================================================

const UNIT_GROUPS = [
    { title: "Uzunluk", units: ["mm", "cm", "m", "km", "ft", "mi", "AU", "ly", "pc"] },
    { title: "Kütle", units: ["mg", "g", "kg", "ton", "lb"] },
    { title: "Zaman", units: ["ms", "s", "dk", "sa", "gün", "yıl"] },
    { title: "Veri", units: ["B", "KB", "MB", "GB", "TB"] }
];

function renderUnitPalette() {
    const container = $("units-groups");
    container.textContent = "";

    UNIT_GROUPS.forEach(group => {
        const wrap = document.createElement("div");
        wrap.className = "unit-group";

        const title = document.createElement("div");
        title.className = "unit-group-title";
        title.textContent = group.title;

        const row = document.createElement("div");
        row.className = "unit-chips";

        group.units.forEach(unit => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "unit-chip";
            chip.textContent = unit;

            chip.addEventListener("click", () => {
                if (!/[\d.]$/.test(expression)) {
                    showToast("Önce bir sayı girin");
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

const CONVERTER_UNITS = {
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

Object.keys(CONVERTER_UNITS).forEach(cat => {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    categorySelect.appendChild(option);
});

function unitsFor(category) {
    return category === "Sıcaklık" ? TEMP_UNITS : Object.keys(CONVERTER_UNITS[category]);
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
    showToast("Sonuç aktarıldı");
});

populateUnits();

// =====================================================================
// ARAÇLAR — number theory, base conversion, list statistics
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
        renderRow(box, "Uyarı", "1 veya daha büyük bir tam sayı gir");
        return;
    }
    if (n > NT_LIMIT) {
        renderRow(box, "Uyarı", "Bu araç 10^12'ye kadar çalışır");
        return;
    }

    const factors = primeFactors(n);
    const groups = groupFactors(factors);

    const notation = n === 1
        ? "1 (asal çarpanı yok)"
        : groups.map(g => g.exp === 1 ? g.base : g.base + "^" + g.exp).join(" × ");

    renderRow(box, "Asal çarpanlar", notation);
    renderRow(box, "Asal mı?", factors.length === 1 && n > 1 ? "Evet" : "Hayır");

    const divisors = divisorsOf(n);
    renderRow(box, "Bölen sayısı", String(divisors.length));
    renderRow(box, "Bölenler toplamı", String(divisors.reduce((s, d) => s + d, 0)));

    const shown = divisors.length > 24
        ? divisors.slice(0, 24).join(", ") + " …"
        : divisors.join(", ");
    renderRow(box, "Bölenler", shown);
}

function renderNumberPair() {
    const box = $("nt-pair");
    box.textContent = "";

    const a = Number($("nt-input").value);
    const b = Number($("nt-second").value);

    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1) return;
    if (a > NT_LIMIT || b > NT_LIMIT) return;

    renderRow(box, "OBEB (" + a + ", " + b + ")", String(gcdOf(a, b)));
    renderRow(box, "OKEK (" + a + ", " + b + ")", String(lcmOf(a, b)));
    renderRow(box, "Aralarında asal mı?", gcdOf(a, b) === 1 ? "Evet" : "Hayır");
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
        renderRow(box, "Uyarı", from + " tabanında geçersiz bir sayı");
        return;
    }

    let value;
    try {
        value = [...digits.toLowerCase()].reduce(
            (acc, c) => acc * BigInt(from) + BigInt(allowed.indexOf(c)),
            0n
        );
    } catch (e) {
        renderRow(box, "Uyarı", "Sayı okunamadı");
        return;
    }

    if (negative) value = -value;

    renderRow(box, "Onluk (10)", value.toString(10));
    renderRow(box, "İkilik (2)", value.toString(2));
    renderRow(box, "Sekizlik (8)", value.toString(8));
    renderRow(box, "Onaltılık (16)", value.toString(16).toUpperCase());

    if (value >= 0n && value <= 0xffffffffn) {
        renderRow(box, "Bit sayısı", value.toString(2).length + " bit");
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
        renderRow(box, "Uyarı", "En az bir sayı gir");
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

    renderRow(box, "Adet", String(n));
    renderRow(box, "Toplam", formatNumber(sum));
    renderRow(box, "Ortalama", formatNumber(mean));
    renderRow(box, "Medyan", formatNumber(median));
    renderRow(box, "Mod", modes.length ? modes.join(", ") : "yok");
    renderRow(box, "En küçük", formatNumber(sorted[0]));
    renderRow(box, "En büyük", formatNumber(sorted[n - 1]));
    renderRow(box, "Açıklık", formatNumber(sorted[n - 1] - sorted[0]));
    renderRow(box, "Varyans (yığın)", formatNumber(popVar));
    renderRow(box, "Std sapma (yığın)", formatNumber(Math.sqrt(popVar)));

    if (sampleVar !== null) {
        renderRow(box, "Varyans (örneklem)", formatNumber(sampleVar));
        renderRow(box, "Std sapma (örneklem)", formatNumber(Math.sqrt(sampleVar)));
    }
}

$("stat-input").addEventListener("input", renderStats);

renderNumberTheory();
renderNumberPair();
renderBases();
renderStats();

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
