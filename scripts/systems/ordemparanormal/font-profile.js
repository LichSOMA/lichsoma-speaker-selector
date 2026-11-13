/** Read top-level CSS rules without splitting quoted URLs or font data at semicolons. */
export function splitRules(css) {
  const source = String(css ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  let start = 0, depth = 0, parens = 0, quote = "", escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\") { escaped = true; continue; }
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(") parens++;
    if (c === ")") parens--;
    if (parens) continue;
    if (c === "{") depth++;
    if (c === "}") depth--;
    if ((c === ";" && !depth) || (c === "}" && !depth)) {
      rules.push(source.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  return rules.filter(Boolean);
}

/** Only font definitions are global; ordinary selectors are replaced by role-scoped rules. */
export function readFontProfile(css) {
  const rules = splitRules(css);
  const definitions = rules.filter(rule => /^@(?:import\b|font-face\s*\{)/i.test(rule));
  const ordinary = rules.filter(rule => !rule.startsWith("@"));
  const marked = ordinary.find(rule => /\.(?:lichsoma-op-font-settings|loi-font-settings|lichsoma-webfont-settings|dx3rd-webfont-settings)\b/.test(rule));
  const profile = marked ?? ordinary[0] ?? "";
  const declarations = {};
  for (const property of ["font-family", "font-weight", "font-style", "font-variation-settings"]) {
    const match = profile.match(new RegExp(`(?:[;{]\\s*)${property}\\s*:\\s*([^;}]+)`, "i"));
    if (match) declarations[property] = match[1].replace(/\s*!important\s*$/i, "").trim();
  }
  return { definitions, declarations };
}


