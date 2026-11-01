// This entry point intentionally serves legacy CommonJS plugin imports.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const engine = require("@programmable/minimatch-engine");
const GLOBSTAR = Object.freeze({ toString: () => "**" });
// glob 6 correlates parsed rows with the original brace expansions. Keep
// those rows separate while retaining the upstream nonrecursive matcher.
class ParsedRows extends engine.Minimatch { mergeRows() {} }
const legacyPart = part => part === engine.GLOBSTAR ? GLOBSTAR
  : typeof part === "string" ? part : {
    _glob: part.pattern,
    toString: () => part.pattern,
    test: value => part.test(String(value)),
    [Symbol.match]: value => part.test(String(value)) ? [String(value)] : null,
  };

function facade(defaults = {}) {
  const selected = engine.defaults(defaults);
  const match = (value, pattern, options) => selected(value, pattern, options);
  Object.assign(match, selected);
  match.minimatch = match;
  match.GLOBSTAR = GLOBSTAR;
  match.Minimatch = class {
    #inner;
    constructor(pattern, options) {
      this.#inner = new ParsedRows(pattern, { ...defaults, ...options });
      Object.assign(this, this.#inner);
      this.set = this.#inner.set.map(row => row.map(legacyPart));
    }
    match(value, partial) { return this.#inner.match(value, partial); }
    hasMagic() { return this.#inner.hasMagic(); }
    static defaults(options) { return facade({ ...defaults, ...options }).Minimatch; }
  };
  match.defaults = options => facade({ ...defaults, ...options });
  return match;
}
module.exports = facade();
