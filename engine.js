/* =====================================================================
   OVID CALCULATOR — HESAP MOTORU (engine)

   Shared by the calculator and the analytic-geometry page. Nothing here
   touches the DOM: it is the tokenizer, the shunting-yard, the AST, the
   Quantity type (value + uncertainty + dimensions + exact rational) and
   the formatting that renders them.
   ===================================================================== */

// =====================================================================
// STORAGE — Safari private mode and full quotas throw on setItem, which
// used to take the whole app down. Persistence is a nicety, not a
// requirement, so failures degrade to in-memory only.
// =====================================================================

const memoryStore = {};

/* privacy.js installs a gate here. It decides whether a given key may be
   written to the device at all. Keeping the check inside storeSet is what
   makes the consent real: a declined category cannot be persisted by any
   caller, present or future, because there is no other way to write.
   Until the gate is installed nothing is allowed to touch localStorage,
   so a first-time visitor's disk stays untouched until they have chosen. */
let storageGate = null;

function setStorageGate(fn) {
    storageGate = fn;
}

function storeAllowed(key) {
    return typeof storageGate === "function" ? storageGate(key) === true : false;
}

function storeGet(key) {
    try {
        const value = window.localStorage.getItem(key);
        return value === null ? (memoryStore[key] ?? null) : value;
    } catch (e) {
        return memoryStore[key] ?? null;
    }
}

/* A declined key still lives in memoryStore, so the app keeps behaving
   normally for this visit — it simply leaves nothing behind afterwards. */
function storeSet(key, value) {
    memoryStore[key] = value;

    if (!storeAllowed(key)) {
        try {
            window.localStorage.removeItem(key);
        } catch (e) {
            /* nothing to clean up */
        }
        return false;
    }

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

/* The only two modes the engine itself reads: DEG/RAD changes what the trig
   functions mean, and fraction mode changes how a result is rendered. Every
   other mode belongs to the interface. */
let angleMode = storeGet("ovid-angle") || "DEG";
let fractionMode = storeGet("ovid-fraction") === "on";

// =====================================================================
// VARIABLES — the geometry page binds x before each sample so the same
// engine that evaluates "2+3*4" can also evaluate "sin(x)/x" across a plot.
// =====================================================================

const VARIABLES = Object.create(null);

function setVariable(name, value) { VARIABLES[name] = value; }
function clearVariables() { for (const k in VARIABLES) delete VARIABLES[k]; }

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
        throw new Error(t("err.dimensionless", { what }));
    }
}

// ---- unit-aware arithmetic with Gaussian error propagation ----

function qAdd(a, b, sign = 1) {
    if (!sameDim(a.dim, b.dim)) throw new Error(t("err.unitMismatch"));
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
    requireDimless(b, t("err.exponent"));

    if (!isDimless(a.dim) && !Number.isInteger(b.v)) {
        throw new Error(t("err.integerExponent"));
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
    if (!sameDim(a.dim, b.dim)) throw new Error(t("err.unitMismatch"));
    if (b.v === 0) throw new Error(t("err.modZero"));

    const value = ((a.v % b.v) + b.v) % b.v;

    // uncertainty is discontinuous across the wrap, so it is not carried
    return new Quantity(value, 0, a.dim, a.unit);
}

function qNeg(a) {
    return new Quantity(-a.v, a.u, a.dim, a.unit, ratNeg(a.r));
}

function factorial(n) {
    if (n < 0 || !Number.isInteger(n)) throw new Error(t("err.factorial"));
    if (n > 170) return Infinity;
    let acc = 1;
    for (let i = 2; i <= n; i++) acc *= i;
    return acc;
}

function qFactorial(a) {
    requireDimless(a, t("err.factorialInput"));

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
            ? t("err.tanUndefined")
            : null
    },
    asin: {
        f: x => fromRadians(Math.asin(x)),
        df: x => 1 / (Math.sqrt(1 - x * x) * radPerUnit()),
        domain: x => (x < -1 || x > 1) ? t("err.asinRange") : null
    },
    acos: {
        f: x => fromRadians(Math.acos(x)),
        df: x => -1 / (Math.sqrt(1 - x * x) * radPerUnit()),
        domain: x => (x < -1 || x > 1) ? t("err.acosRange") : null
    },
    atan: { f: x => fromRadians(Math.atan(x)), df: x => 1 / ((1 + x * x) * radPerUnit()) },
    ln: {
        f: Math.log,
        df: x => 1 / x,
        domain: x => x < 0 ? t("err.lnNegative") : (x === 0 ? t("err.lnZero") : null)
    },
    log: {
        f: Math.log10,
        df: x => 1 / (x * Math.LN10),
        domain: x => x < 0 ? t("err.logNegative") : (x === 0 ? t("err.logZero") : null)
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
        if (a.v < 0) throw new Error(t("err.negativeRoot"));
        if (a.dim.some(d => d % 2 !== 0)) throw new Error(t("err.rootOfUnit"));
        return new Quantity(
            Math.sqrt(a.v),
            a.u / (2 * Math.sqrt(a.v)),
            scaleDim(a.dim, 0.5)
        );
    }

    requireDimless(a, t("err.functionInput", { fn: name }));

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
    in: { f: 0.0254, d: [1, 0, 0, 0] },
    AU: { f: 1.495978707e11, d: [1, 0, 0, 0] },
    ly: { f: 9.4607304725808e15, d: [1, 0, 0, 0] },
    pc: { f: 3.0856775814913673e16, d: [1, 0, 0, 0] },

    // mass
    kg: { f: 1, d: [0, 1, 0, 0] },
    g: { f: 0.001, d: [0, 1, 0, 0] },
    mg: { f: 1e-6, d: [0, 1, 0, 0] },
    ton: { f: 1000, d: [0, 1, 0, 0] },
    t: { f: 1000, d: [0, 1, 0, 0] },
    oz: { f: 0.028349523125, d: [0, 1, 0, 0] },
    lb: { f: 0.45359237, d: [0, 1, 0, 0] },

    // time
    s: { f: 1, d: [0, 0, 1, 0] },
    ms: { f: 0.001, d: [0, 0, 1, 0] },
    dk: { f: 60, d: [0, 0, 1, 0] },
    min: { f: 60, d: [0, 0, 1, 0] },
    sa: { f: 3600, d: [0, 0, 1, 0] },
    h: { f: 3600, d: [0, 0, 1, 0] },
    gün: { f: 86400, d: [0, 0, 1, 0] },
    day: { f: 86400, d: [0, 0, 1, 0] },
    week: { f: 604800, d: [0, 0, 1, 0] },
    yıl: { f: 31557600, d: [0, 0, 1, 0] },
    yr: { f: 31557600, d: [0, 0, 1, 0] },

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
        if ((num.match(/\./g) || []).length > 1) throw new Error(t("err.invalidNumber"));
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
                if (!/[0-9.]/.test(input[i] || "")) throw new Error(t("err.afterUncert"));
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
            } else if (name in VARIABLES) {
                // a bound variable is a plain float: no exact form to preserve
                tokens.push({ type: "number", value: VARIABLES[name], uncert: 0, unit: null, raw: null });
            } else {
                throw new Error(t("err.unknownToken") + name);
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

        throw new Error(t("err.invalidChar") + ch);
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
                    if (!found) throw new Error(t("err.brackets"));
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
        if (top.type === "paren") throw new Error(t("err.brackets"));
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
        if (!stack.length) throw new Error(t("err.incomplete"));
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

    if (stack.length !== 1) throw new Error(t("err.incomplete"));
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
    throw new Error(t("err.incomplete"));
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

