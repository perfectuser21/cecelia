const PATTERNS = [
  { re: /(Bearer)\s+([A-Za-z0-9._-]{4,})/gi, fn: (_m, word, tok) => `${word} ****${tok.slice(-4)}` },
  { re: /(:\/\/[^:@\s]+:)([^@\s]+)(@)/g, fn: (_m, pre, _pass, post) => `${pre}****${post}` },
  { re: /sk-[A-Za-z0-9]{16,}/g, fn: () => 'sk-****' },
  { re: /ghp_[A-Za-z0-9]{16,}/g, fn: () => 'ghp_****' },
];

export function redact(text) {
  let out = text;
  for (const { re, fn } of PATTERNS) {
    out = out.replace(re, fn);
  }
  return out;
}
