// A minimal `when` clause evaluator, after VS Code's context key expressions:
// `key`, `!key`, `key == value`, `key != value`, `&&`, `||` and parentheses.
// `!` binds tightest, then `==`/`!=`, then `&&`, then `||`. Values may be quoted
// ('a b') or bare (`view == publisher.name.view`); `true`/`false` compare as booleans.

export type ContextValue = string | number | boolean | null | undefined;
export type ContextLookup = (key: string) => unknown;

type Node =
  | { kind: "key"; key: string }
  | { kind: "literal"; value: boolean }
  | { kind: "not"; operand: Node }
  | { kind: "equals"; key: string; value: string | boolean; negate: boolean }
  | { kind: "and" | "or"; left: Node; right: Node };

type Token =
  | { kind: "word"; text: string }
  | { kind: "string"; text: string }
  | { kind: "op"; text: "!" | "==" | "!=" | "&&" | "||" | "(" | ")" };

const WORD = /[^\s!=&|()'"]+/y;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const two = source.slice(index, index + 2);
    if (two === "==" || two === "!=" || two === "&&" || two === "||") {
      tokens.push({ kind: "op", text: two });
      index += 2;
      // VS Code also accepts `===` and `!==`.
      if (source[index] === "=") index += 1;
      continue;
    }
    if (char === "!" || char === "(" || char === ")") {
      tokens.push({ kind: "op", text: char });
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      const end = source.indexOf(char, index + 1);
      if (end === -1) throw new SyntaxError(`unterminated string at ${index}`);
      tokens.push({ kind: "string", text: source.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    WORD.lastIndex = index;
    const match = WORD.exec(source);
    if (!match) throw new SyntaxError(`unexpected '${char}' at ${index}`);
    tokens.push({ kind: "word", text: match[0] });
    index += match[0].length;
  }
  return tokens;
}

function parse(source: string): Node {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const isOp = (text: string) => {
    const token = peek();
    return token?.kind === "op" && token.text === text;
  };
  const expectWord = (): string => {
    const token = tokens[position++];
    if (!token || token.kind === "op") throw new SyntaxError("expected a context key");
    return token.text;
  };

  const parseOr = (): Node => {
    let left = parseAnd();
    while (isOp("||")) {
      position += 1;
      left = { kind: "or", left, right: parseAnd() };
    }
    return left;
  };
  const parseAnd = (): Node => {
    let left = parseUnary();
    while (isOp("&&")) {
      position += 1;
      left = { kind: "and", left, right: parseUnary() };
    }
    return left;
  };
  const parseUnary = (): Node => {
    if (isOp("!")) {
      position += 1;
      return { kind: "not", operand: parseUnary() };
    }
    if (isOp("(")) {
      position += 1;
      const inner = parseOr();
      if (!isOp(")")) throw new SyntaxError("expected ')'");
      position += 1;
      return inner;
    }
    const token = peek();
    if (token?.kind === "word" && (token.text === "true" || token.text === "false")) {
      position += 1;
      return { kind: "literal", value: token.text === "true" };
    }
    const key = expectWord();
    if (isOp("==") || isOp("!=")) {
      const negate = isOp("!=");
      position += 1;
      const valueToken = tokens[position++];
      if (!valueToken || valueToken.kind === "op") throw new SyntaxError("expected a value");
      const value =
        valueToken.kind === "word" && (valueToken.text === "true" || valueToken.text === "false")
          ? valueToken.text === "true"
          : valueToken.text;
      return { kind: "equals", key, value, negate };
    }
    return { kind: "key", key };
  };

  if (tokens.length === 0) throw new SyntaxError("empty expression");
  const node = parseOr();
  if (position !== tokens.length) throw new SyntaxError(`unexpected token at ${position}`);
  return node;
}

function matches(actual: unknown, expected: string | boolean): boolean {
  if (typeof expected === "boolean") return actual === expected;
  // Like VS Code, compare against the value's string form (numbers, for example).
  return actual !== undefined && actual !== null && String(actual) === expected;
}

function evaluate(node: Node, lookup: ContextLookup): boolean {
  switch (node.kind) {
    case "key":
      return Boolean(lookup(node.key));
    case "literal":
      return node.value;
    case "not":
      return !evaluate(node.operand, lookup);
    case "equals":
      return matches(lookup(node.key), node.value) !== node.negate;
    case "and":
      return evaluate(node.left, lookup) && evaluate(node.right, lookup);
    case "or":
      return evaluate(node.left, lookup) || evaluate(node.right, lookup);
  }
}

/** A parsed `when` clause. */
export interface WhenClause {
  readonly source: string;
  readonly evaluate: (lookup: ContextLookup) => boolean;
  /** The context keys it reads. */
  readonly keys: readonly string[];
}

function collectKeys(node: Node, into: Set<string>): void {
  if (node.kind === "key" || node.kind === "equals") into.add(node.key);
  else if (node.kind === "not") collectKeys(node.operand, into);
  else if (node.kind === "and" || node.kind === "or") {
    collectKeys(node.left, into);
    collectKeys(node.right, into);
  }
}

/** Parses `source`; throws a SyntaxError for an invalid clause. */
export function parseWhen(source: string): WhenClause {
  const node = parse(source);
  const keys = new Set<string>();
  collectKeys(node, keys);
  return Object.freeze({
    source,
    evaluate: (lookup: ContextLookup) => evaluate(node, lookup),
    keys: Object.freeze([...keys]),
  });
}
