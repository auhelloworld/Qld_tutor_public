/**
 * function-plot.ts — safe maths-expression evaluation for DiagramRenderer's
 * `function_graph`.
 *
 * Why this exists: the renderer previously only plotted `kind: 'linear'` and
 * `kind: 'quadratic'` objects, so any string spec (e.g. "f(x)=2*x") or any
 * other curve (exp, log, trig, rational, normal pdf) rendered nothing. This
 * module compiles a curve specification into a numeric sampler WITHOUT using
 * `eval`/`Function` (a hand-written recursive-descent parser over a fixed
 * whitelist of operators and functions), so it is safe under strict CSP.
 *
 * A "function spec" accepted by {@link compileFunction} may be:
 *   - a string expression, optionally prefixed ("y=…", "f(x)=…") and/or
 *     suffixed with a domain ("… for 0<=x<=2");
 *   - an object with `{ expr: string, domain?: string }`;
 *   - an object with `{ expression: string, domain?: string }` (legacy lesson content alias);
 *   - an object with `{ kind: 'linear'|'quadratic'|'cubic'|'quartic'|
 *     'exponential'|'logarithmic'|'sine'|'cosine'|'tangent'|'reciprocal'|
 *     'power'|'normal_pdf', ...params }`.
 * Objects carrying `points` are NOT functions (the renderer polylines them
 * directly) and return null here.
 *
 * Supported expression grammar:
 *   numbers, variable `x`, constants `pi`/`e`,
 *   binary `+ - * /`, `^` (right-assoc power), unary `-`/`+`, parentheses,
 *   functions: sin cos tan asin acos atan sinh cosh tanh
 *              exp ln log log10 lg sqrt cbrt abs sign floor ceil round.
 *   (`ln`/`log` are natural log; `log10`/`lg` are base 10.)
 */

export type FunctionSpec = string | Record<string, any>;

type Sampler = (x: number) => number | null;

// ---------------------------------------------------------------------------
// Expression parser / compiler
// ---------------------------------------------------------------------------

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log,
  log10: Math.log10, lg: Math.log10,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  sign: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Token = { t: 'num'; v: number } | { t: 'id'; v: string }
  | { t: 'op'; v: string } | { t: 'paren'; v: '(' | ')' } | { t: 'comma' };

function tokenize(src: string): Token[] | null {
  const s = src.replace(/\s+/g, '');
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c >= '0' && c <= '9' || c === '.') {
      let j = i + 1;
      while (j < s.length && /[0-9.eE+\-]/.test(s[j])) {
        // allow scientific notation like 1e-3 but stop a stray sign that is an operator
        if ((s[j] === '+' || s[j] === '-') && !(s[j - 1] === 'e' || s[j - 1] === 'E')) break;
        if ((s[j] === 'e' || s[j] === 'E') && !/[0-9.]/.test(s[j + 1] ?? '') && !(s[j + 1] === '+' || s[j + 1] === '-')) break;
        j++;
      }
      const num = Number(s.slice(i, j));
      if (!isFinite(num)) return null;
      out.push({ t: 'num', v: num });
      i = j;
    } else if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      out.push({ t: 'id', v: s.slice(i, j) });
      i = j;
    } else if ('+-*/^'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else if (c === '(' || c === ')') {
      out.push({ t: 'paren', v: c });
      i++;
    } else if (c === ',') {
      out.push({ t: 'comma' });
      i++;
    } else {
      return null; // unknown character
    }
  }
  return insertImplicitMultiplication(out);
}

/**
 * Inserts the `*` that authored content routinely omits.
 *
 * Authored lesson and exercise payloads write `5x`, `2(x+1)` and `(x+1)(x-1)`.
 * Without this the parser rejected the whole expression and the diagram drew
 * only its axes — for example `f_A(x) = 100 - 5x` in
 * `science_7_u05_i04_hp15` produced an empty graph.
 *
 * Only unambiguous adjacencies get a `*`: a number before a name or `(`, and a
 * `)` before a number, name or `(`. A name directly before `(` is left alone
 * when it is a known function, so `sin(x)` is still a call rather than
 * `sin * (x)`.
 */
function insertImplicitMultiplication(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i];
    out.push(current);
    const next = tokens[i + 1];
    if (!next) continue;

    const currentEndsValue =
      current.t === 'num' || current.t === 'id' || (current.t === 'paren' && current.v === ')');
    const nextStartsValue =
      next.t === 'num' || next.t === 'id' || (next.t === 'paren' && next.v === '(');
    if (!currentEndsValue || !nextStartsValue) continue;

    // `sin(x)` and `x2` stay as they are: one is a call, the other ambiguous.
    if (current.t === 'id' && next.t === 'paren') continue;
    if (current.t === 'id' && (next.t === 'num' || next.t === 'id')) continue;

    out.push({ t: 'op', v: '*' });
  }
  return out;
}

type Node = (x: number) => number;

/** Recursive-descent parser producing a closure. Returns null on parse error. */
function parse(tokens: Token[]): Node | null {
  let pos = 0;
  const peek = (): any => tokens[pos];
  const eat = () => tokens[pos++];
  let failed = false;
  const fail = (): null => { failed = true; return null; };

  // expr := term (('+'|'-') term)*
  function parseExpr(): Node | null {
    let left = parseTerm();
    if (left === null) return null;
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = (eat() as any).v;
      const right = parseTerm();
      if (right === null) return null;
      const l = left, r = right;
      left = op === '+' ? (x) => l(x) + r(x) : (x) => l(x) - r(x);
    }
    return left;
  }
  // term := unary (('*'|'/') unary)*
  function parseTerm(): Node | null {
    let left = parseUnary();
    if (left === null) return null;
    while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
      const op = (eat() as any).v;
      const right = parseUnary();
      if (right === null) return null;
      const l = left, r = right;
      left = op === '*' ? (x) => l(x) * r(x) : (x) => l(x) / r(x);
    }
    return left;
  }
  // unary := ('-'|'+') unary | power
  function parseUnary(): Node | null {
    if (peek() && peek().t === 'op' && (peek().v === '-' || peek().v === '+')) {
      const op = (eat() as any).v;
      const operand = parseUnary();
      if (operand === null) return null;
      const o = operand;
      return op === '-' ? (x) => -o(x) : o;
    }
    return parsePower();
  }
  // power := atom ('^' unary)?   (right-associative)
  function parsePower(): Node | null {
    const base = parseAtom();
    if (base === null) return null;
    if (peek() && peek().t === 'op' && peek().v === '^') {
      eat();
      const exp = parseUnary();
      if (exp === null) return null;
      const b = base, e = exp;
      return (x) => Math.pow(b(x), e(x));
    }
    return base;
  }
  // atom := num | const | x | func '(' expr ')' | '(' expr ')'
  function parseAtom(): Node | null {
    const tk = peek();
    if (!tk) return fail();
    if (tk.t === 'num') { eat(); const v = tk.v; return () => v; }
    if (tk.t === 'paren' && tk.v === '(') {
      eat();
      const inner = parseExpr();
      if (inner === null) return null;
      if (!(peek() && peek().t === 'paren' && peek().v === ')')) return fail();
      eat();
      return inner;
    }
    if (tk.t === 'id') {
      eat();
      const name = tk.v.toLowerCase();
      // function call
      if (peek() && peek().t === 'paren' && peek().v === '(') {
        const fn = FUNCS[name];
        if (!fn) return fail();
        eat();
        const arg = parseExpr();
        if (arg === null) return null;
        if (!(peek() && peek().t === 'paren' && peek().v === ')')) return fail();
        eat();
        const a = arg;
        return (x) => fn(a(x));
      }
      if (name === 'x') return (x) => x;
      if (name in CONSTS) { const v = CONSTS[name]; return () => v; }
      return fail();
    }
    return fail();
  }

  const root = parseExpr();
  if (root === null || failed || pos !== tokens.length) return null;
  return root;
}

function compileExpression(expr: string): Node | null {
  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) return null;
  return parse(tokens);
}

// ---------------------------------------------------------------------------
// Domain ("for 0<=x<=2") parsing
// ---------------------------------------------------------------------------

/** Returns a predicate (x)=>boolean, or null if no/!parseable domain. */
export function parseDomain(raw: string): ((x: number) => boolean) | null {
  const s = raw.replace(/\s+/g, '').toLowerCase();
  // a<=x<=b   /  a<x<b  (mixed </<=)
  let m = s.match(/^(-?[\d.]+)(<=?)x(<=?)(-?[\d.]+)$/);
  if (m) {
    const lo = Number(m[1]), hi = Number(m[4]);
    const loInc = m[2] === '<=', hiInc = m[3] === '<=';
    if (!isFinite(lo) || !isFinite(hi)) return null;
    return (x) => (loInc ? x >= lo : x > lo) && (hiInc ? x <= hi : x < hi);
  }
  // x<a / x<=a / x>a / x>=a
  m = s.match(/^x(<=?|>=?)(-?[\d.]+)$/);
  if (m) {
    const val = Number(m[2]);
    if (!isFinite(val)) return null;
    switch (m[1]) {
      case '<': return (x) => x < val;
      case '<=': return (x) => x <= val;
      case '>': return (x) => x > val;
      case '>=': return (x) => x >= val;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Kind-based specs (numeric coefficients, no expression text)
// ---------------------------------------------------------------------------

function compileKind(fn: Record<string, any>): Sampler | null {
  const n = (k: string, d = 0) => (typeof fn[k] === 'number' ? fn[k] : d);
  switch (fn.kind) {
    case 'linear': { const m = n('m'), b = n('b'); return (x) => m * x + b; }
    case 'quadratic': { const a = n('a', 1), b = n('b'), c = n('c'); return (x) => a * x * x + b * x + c; }
    case 'cubic': { const a = n('a', 1), b = n('b'), c = n('c'), d = n('d'); return (x) => a * x ** 3 + b * x ** 2 + c * x + d; }
    case 'quartic': { const a = n('a', 1), b = n('b'), c = n('c'), d = n('d'), e = n('e'); return (x) => a * x ** 4 + b * x ** 3 + c * x ** 2 + d * x + e; }
    case 'power': { const a = n('a', 1), p = n('p', 1), c = n('c'); return (x) => { const v = a * Math.pow(x, p) + c; return isFinite(v) ? v : null; }; }
    case 'exponential': { const a = n('a', 1), base = n('base', Math.E), k = n('k', 1), c = n('c'); return (x) => a * Math.pow(base, k * x) + c; }
    case 'logarithmic': { const a = n('a', 1), base = n('base', Math.E), k = n('k', 1), c = n('c'); const lb = Math.log(base); return (x) => { const arg = k * x; if (arg <= 0) return null; return a * (Math.log(arg) / lb) + c; }; }
    case 'sine': { const a = n('a', 1), b = n('b', 1), c = n('c'), d = n('d'); return (x) => a * Math.sin(b * x + c) + d; }
    case 'cosine': { const a = n('a', 1), b = n('b', 1), c = n('c'), d = n('d'); return (x) => a * Math.cos(b * x + c) + d; }
    case 'tangent': { const a = n('a', 1), b = n('b', 1), c = n('c'), d = n('d'); return (x) => { const v = a * Math.tan(b * x + c) + d; return isFinite(v) ? v : null; }; }
    case 'reciprocal': { const a = n('a', 1), h = n('h'), k = n('k'); return (x) => { if (x === h) return null; return a / (x - h) + k; }; }
    case 'normal_pdf': { const mu = n('mu', 0), sigma = n('sigma', 1), scale = n('scale', 1); if (sigma <= 0) return null; const coeff = scale / (sigma * Math.sqrt(2 * Math.PI)); return (x) => coeff * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)); }
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Public: compile a function spec into a sampler
// ---------------------------------------------------------------------------

/**
 * Compile a curve spec into a sampler `(x)=>number|null` (null = undefined /
 * out-of-domain at that x). Returns null if the spec is not a plottable
 * function (e.g. a `points` polyline) or cannot be parsed.
 */
export function compileFunction(spec: FunctionSpec): Sampler | null {
  if (spec == null) return null;

  if (typeof spec === 'string') return compileFromString(spec);

  if (typeof spec === 'object') {
    if (Array.isArray((spec as any).points)) return null; // handled as polyline elsewhere
    if (typeof spec.kind === 'string') {
      const base = compileKind(spec);
      if (!base) return null;
      const dom = typeof spec.domain === 'string' ? parseDomain(spec.domain) : null;
      return wrapDomain(base, dom);
    }
    const expression = typeof spec.expr === 'string'
      ? spec.expr
      : typeof spec.expression === 'string'
        ? spec.expression
        : null;
    if (expression) {
      const sampler = compileFromString(expression);
      if (!sampler) return null;
      const dom = typeof spec.domain === 'string' ? parseDomain(spec.domain) : null;
      return dom ? wrapDomain(sampler, dom) : sampler;
    }
  }
  return null;
}

function compileFromString(raw: string): Sampler | null {
  let body = raw.trim();
  let domain: ((x: number) => boolean) | null = null;

  // Split off a trailing domain restriction: "... for 0<=x<=2"
  const forIdx = body.toLowerCase().lastIndexOf(' for ');
  if (forIdx !== -1) {
    domain = parseDomain(body.slice(forIdx + 5));
    body = body.slice(0, forIdx).trim();
  }
  // Strip a leading "y =" / "f(x) =" label (only if a single '=' remains).
  const eq = body.indexOf('=');
  if (eq !== -1 && body.indexOf('=', eq + 1) === -1) {
    body = body.slice(eq + 1).trim();
  }
  const node = compileExpression(body);
  if (!node) return null;
  const sampler: Sampler = (x) => { const v = node(x); return isFinite(v) ? v : null; };
  return wrapDomain(sampler, domain);
}

function wrapDomain(sampler: Sampler, domain: ((x: number) => boolean) | null): Sampler {
  if (!domain) return sampler;
  return (x) => (domain(x) ? sampler(x) : null);
}
