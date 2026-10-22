/**
 * Numeric-sampling equivalence checker for Maths Lab Learn answers.
 *
 * Purpose
 * -------
 * `lab-answer-normalise.ts` only canonicalises characters; it deliberately does
 * not evaluate anything. That made it impossible to author steps whose answer is
 * an *expression* (a derivative, a tangent rule, a general solution), because
 * every acceptable surface form had to be hard-coded in `acceptedAnswers`.
 *
 * This module adds an opt-in third marking layer: parse both the student answer
 * and the authored answer with a small self-contained recursive-descent parser,
 * then compare their values at several deterministic sample points.
 *
 * Design constraints
 * ------------------
 * - No `eval`, no `new Function`, no third-party dependency.
 * - Opt-in per step (`LearnStep.equivalence`). Steps without it keep the exact
 *   previous marking behaviour, so no previously-correct answer can regress and
 *   no previously-rejected answer is silently accepted.
 * - Identifiers are restricted to the declared variables plus known constants
 *   and functions. Anything else is a parse failure, so junk such as `4abc`
 *   stays rejected instead of being read as `4*a*b*c`.
 * - Bounded work: input length, token count and recursion depth are all capped,
 *   and sampling uses a fixed point list (no PRNG, no timing dependence).
 */

/** Per-step configuration that switches the equivalence layer on. */
export interface AnswerEquivalence {
  /**
   * Free variables the answer may contain, e.g. `['x']` or `['t']`.
   * Omit or leave empty for constant-only answers such as `8π` or `ln(2)/2`.
   */
  variables?: string[];
  /** Closed sample interval for the variables. Defaults to [-3.5, 3.5]. */
  sampleDomain?: [number, number];
  /**
   * Relative tolerance for agreement at a sample point. Defaults to 1e-7,
   * which accepts genuine algebraic rewrites but rejects rounded decimals
   * substituted for exact values.
   */
  relativeTolerance?: number;
}

const MAX_INPUT_LENGTH = 240;
const MAX_TOKENS = 200;
const MAX_DEPTH = 40;
/** Sample points must agree at least this many times for a verdict of equal. */
const MIN_JOINT_SAMPLES = 5;

/** Fixed, irrational-ish fractions of the sample interval — never a nice value. */
const SAMPLE_FRACTIONS = [
  0.113_249, 0.271_828, 0.381_966, 0.447_213, 0.577_350,
  0.632_120, 0.718_281, 0.816_496, 0.909_090, 0.951_057,
];

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
};

const FUNCTIONS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  ln: Math.log,
  log: (v) => Math.log10(v),
  log10: (v) => Math.log10(v),
  exp: Math.exp,
  abs: Math.abs,
};

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type TokenType = 'number' | 'ident' | 'op' | 'lparen' | 'rparen' | 'bar';

interface Token {
  type: TokenType;
  value: string;
  num?: number;
}

const OPERATORS = new Set(['+', '-', '*', '/', '^']);

function tokenize(input: string): Token[] | null {
  if (input.length > MAX_INPUT_LENGTH) return null;
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === ' ') {
      i += 1;
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < input.length && input[j] >= '0' && input[j] <= '9') j += 1;
      if (input[j] === '.') {
        j += 1;
        while (j < input.length && input[j] >= '0' && input[j] <= '9') j += 1;
      }
      const text = input.slice(i, j);
      const num = Number(text);
      if (!Number.isFinite(num)) return null;
      tokens.push({ type: 'number', value: text, num });
      i = j;
      continue;
    }

    if (ch === '.') {
      let j = i + 1;
      while (j < input.length && input[j] >= '0' && input[j] <= '9') j += 1;
      if (j === i + 1) return null;
      const num = Number(input.slice(i, j));
      if (!Number.isFinite(num)) return null;
      tokens.push({ type: 'number', value: input.slice(i, j), num });
      i = j;
      continue;
    }

    if ((ch >= 'a' && ch <= 'z') || ch === 'π' || ch === 'θ') {
      let j = i;
      while (j < input.length) {
        const c = input[j];
        if ((c >= 'a' && c <= 'z') || c === '_' || (c >= '0' && c <= '9' && j > i)) {
          // Digits inside an identifier are only allowed for log10.
          if (c >= '0' && c <= '9' && input.slice(i, j) !== 'log') break;
          j += 1;
          continue;
        }
        break;
      }
      if (j === i) j = i + 1; // single-character symbol such as π or θ
      tokens.push({ type: 'ident', value: input.slice(i, j) });
      i = j;
      continue;
    }

    if (OPERATORS.has(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      tokens.push({ type: 'lparen', value: '(' });
      i += 1;
      continue;
    }

    if (ch === ')' || ch === ']' || ch === '}') {
      tokens.push({ type: 'rparen', value: ')' });
      i += 1;
      continue;
    }

    if (ch === '|') {
      tokens.push({ type: 'bar', value: '|' });
      i += 1;
      continue;
    }

    if (ch === '√') {
      tokens.push({ type: 'ident', value: 'sqrt' });
      i += 1;
      continue;
    }

    // Any other character (including '=', ',', '%') is unsupported here.
    return null;
  }

  if (tokens.length === 0 || tokens.length > MAX_TOKENS) return null;
  return tokens;
}

// ─── Parser (recursive descent → evaluation closure) ─────────────────────────

type Evaluator = (env: Record<string, number>) => number;

interface ParseContext {
  tokens: Token[];
  pos: number;
  depth: number;
  allowedVariables: Set<string>;
  failed: boolean;
}

function fail(ctx: ParseContext): Evaluator {
  ctx.failed = true;
  return () => Number.NaN;
}

function peek(ctx: ParseContext): Token | undefined {
  return ctx.tokens[ctx.pos];
}

function parseExpression(ctx: ParseContext): Evaluator {
  if (ctx.failed) return () => Number.NaN;
  if (++ctx.depth > MAX_DEPTH) return fail(ctx);

  let left = parseTerm(ctx);
  for (;;) {
    if (ctx.failed) break;
    const token = peek(ctx);
    if (!token || token.type !== 'op' || (token.value !== '+' && token.value !== '-')) break;
    ctx.pos += 1;
    const right = parseTerm(ctx);
    const op = token.value;
    const l = left;
    left = op === '+' ? (env) => l(env) + right(env) : (env) => l(env) - right(env);
  }

  ctx.depth -= 1;
  return left;
}

/** True when the token can begin a primary, so implicit multiplication applies. */
function startsPrimary(token: Token | undefined): boolean {
  if (!token) return false;
  return token.type === 'number' || token.type === 'ident' || token.type === 'lparen';
}

function parseTerm(ctx: ParseContext): Evaluator {
  if (ctx.failed) return () => Number.NaN;
  if (++ctx.depth > MAX_DEPTH) return fail(ctx);

  let left = parseUnary(ctx);
  for (;;) {
    if (ctx.failed) break;
    const token = peek(ctx);
    const posBefore = ctx.pos;
    if (token && token.type === 'op' && (token.value === '*' || token.value === '/')) {
      ctx.pos += 1;
      const right = parseUnary(ctx);
      const l = left;
      left = token.value === '*' ? (env) => l(env) * right(env) : (env) => l(env) / right(env);
      continue;
    }
    // Implicit multiplication: 2x, 3(x+1), 2π, x√2
    if (startsPrimary(token)) {
      const right = parseUnary(ctx);
      // A sub-parse that consumed nothing would loop forever; treat as failure.
      if (ctx.failed || ctx.pos === posBefore) {
        ctx.failed = true;
        break;
      }
      const l = left;
      left = (env) => l(env) * right(env);
      continue;
    }
    break;
  }

  ctx.depth -= 1;
  return left;
}

function parseUnary(ctx: ParseContext): Evaluator {
  if (ctx.failed) return () => Number.NaN;
  const token = peek(ctx);
  if (token && token.type === 'op' && (token.value === '-' || token.value === '+')) {
    ctx.pos += 1;
    const operand = parseUnary(ctx);
    return token.value === '-' ? (env) => -operand(env) : operand;
  }
  return parsePower(ctx);
}

function parsePower(ctx: ParseContext): Evaluator {
  if (ctx.failed) return () => Number.NaN;
  const base = parsePrimary(ctx);
  const token = peek(ctx);
  if (token && token.type === 'op' && token.value === '^') {
    ctx.pos += 1;
    const exponent = parseUnary(ctx); // right associative, allows 2^-x
    return (env) => Math.pow(base(env), exponent(env));
  }
  return base;
}

function parsePrimary(ctx: ParseContext): Evaluator {
  if (ctx.failed) return () => Number.NaN;
  if (++ctx.depth > MAX_DEPTH) return fail(ctx);
  const token = peek(ctx);
  if (!token) return fail(ctx);

  if (token.type === 'number') {
    ctx.pos += 1;
    const value = token.num as number;
    ctx.depth -= 1;
    return () => value;
  }

  if (token.type === 'lparen') {
    ctx.pos += 1;
    const inner = parseExpression(ctx);
    const closing = peek(ctx);
    if (!closing || closing.type !== 'rparen') return fail(ctx);
    ctx.pos += 1;
    ctx.depth -= 1;
    return inner;
  }

  if (token.type === 'bar') {
    ctx.pos += 1;
    const inner = parseExpression(ctx);
    const closing = peek(ctx);
    if (!closing || closing.type !== 'bar') return fail(ctx);
    ctx.pos += 1;
    ctx.depth -= 1;
    return (env) => Math.abs(inner(env));
  }

  if (token.type === 'ident') {
    const name = token.value;
    ctx.pos += 1;

    // Variables take precedence so an activity can legitimately use `e` or `pi`.
    if (ctx.allowedVariables.has(name)) {
      ctx.depth -= 1;
      return (env) => (name in env ? env[name] : Number.NaN);
    }

    const fn = FUNCTIONS[name];
    if (fn) {
      const next = peek(ctx);
      if (next && next.type === 'lparen') {
        ctx.pos += 1;
        const arg = parseExpression(ctx);
        const closing = peek(ctx);
        if (!closing || closing.type !== 'rparen') return fail(ctx);
        ctx.pos += 1;
        ctx.depth -= 1;
        return (env) => fn(arg(env));
      }
      if (name === 'sqrt' && next && (next.type === 'number' || next.type === 'ident')) {
        // Bare √2 / √x is idiomatic student input.
        const arg = parsePrimary(ctx);
        ctx.depth -= 1;
        return (env) => fn(arg(env));
      }
      return fail(ctx);
    }

    if (name in CONSTANTS) {
      const value = CONSTANTS[name];
      ctx.depth -= 1;
      return () => value;
    }

    // Unknown identifier — reject rather than inventing a variable.
    return fail(ctx);
  }

  return fail(ctx);
}

/** Parsed expression plus the variables it is allowed to reference. */
export interface ParsedExpression {
  evaluate: Evaluator;
}

/**
 * Parse a single mathematical expression.
 * Returns `null` when the text is not a well-formed expression over the
 * allowed variables, known constants and known functions.
 */
export function parseExpressionText(
  text: string,
  allowedVariables: readonly string[] = [],
): ParsedExpression | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const tokens = tokenize(trimmed);
  if (!tokens) return null;

  const ctx: ParseContext = {
    tokens,
    pos: 0,
    depth: 0,
    allowedVariables: new Set(allowedVariables),
    failed: false,
  };
  const evaluator = parseExpression(ctx);
  if (ctx.failed || ctx.pos !== tokens.length) return null;
  return { evaluate: evaluator };
}

// ─── Equivalence comparison ──────────────────────────────────────────────────

function sampleEnvironments(
  variables: readonly string[],
  domain: [number, number],
): Record<string, number>[] {
  const [lo, hi] = domain;
  const span = hi - lo;
  const environments: Record<string, number>[] = [];
  for (let s = 0; s < SAMPLE_FRACTIONS.length; s += 1) {
    const env: Record<string, number> = {};
    variables.forEach((name, index) => {
      // Offset each variable so multivariable answers are not tested on x = y.
      const fraction = SAMPLE_FRACTIONS[(s + index * 3) % SAMPLE_FRACTIONS.length];
      env[name] = lo + span * fraction;
    });
    environments.push(env);
  }
  return environments;
}

function valuesAgree(a: number, b: number, relativeTolerance: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= relativeTolerance * scale;
}

/**
 * Decide whether two answer strings denote the same mathematical object by
 * evaluating both at deterministic sample points.
 *
 * Returns `false` (never throws) when either side cannot be parsed, when too
 * few sample points are jointly defined, or when any joint sample disagrees.
 */
export function expressionsEquivalent(
  studentText: string,
  acceptedText: string,
  config: AnswerEquivalence = {},
): boolean {
  const variables = config.variables ?? [];
  const domain = config.sampleDomain ?? [-3.5, 3.5];
  const relativeTolerance = config.relativeTolerance ?? 1e-7;

  const student = parseExpressionText(studentText, variables);
  if (!student) return false;
  const accepted = parseExpressionText(acceptedText, variables);
  if (!accepted) return false;

  if (variables.length === 0) {
    const a = student.evaluate({});
    const b = accepted.evaluate({});
    return valuesAgree(a, b, relativeTolerance);
  }

  let joint = 0;
  for (const env of sampleEnvironments(variables, domain)) {
    const a = student.evaluate(env);
    const b = accepted.evaluate(env);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (!valuesAgree(a, b, relativeTolerance)) return false;
    joint += 1;
  }
  return joint >= MIN_JOINT_SAMPLES;
}

/**
 * Tuple-aware wrapper: compares `1/2, 3` against `0.5, 3` component by
 * component, and falls back to single-expression comparison otherwise.
 * Surrounding brackets are ignored so `(0.5, 3)` and `0.5, 3` agree.
 */
export function answersEquivalent(
  studentText: string,
  acceptedText: string,
  config: AnswerEquivalence = {},
): boolean {
  const studentParts = splitTuple(studentText);
  const acceptedParts = splitTuple(acceptedText);
  if (studentParts.length !== acceptedParts.length) return false;
  if (studentParts.length === 1) {
    return expressionsEquivalent(studentParts[0], acceptedParts[0], config);
  }
  return studentParts.every((part, index) =>
    expressionsEquivalent(part, acceptedParts[index], config),
  );
}

/** Split `(1, 2)` or `1, 2` into components, keeping bracketed groups intact. */
function splitTuple(text: string): string[] {
  let body = text.trim();
  if (
    (body.startsWith('(') && body.endsWith(')')) ||
    (body.startsWith('[') && body.endsWith(']'))
  ) {
    const inner = body.slice(1, -1);
    if (balancedBrackets(inner)) body = inner;
  }
  if (!body.includes(',')) return [body];

  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim());
}

function balancedBrackets(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}
