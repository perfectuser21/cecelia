---
task_id: 15cf9cad-f2a6-4e03-bb67-f2add83afecc
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---
# 验收证据

### E-1
对应: I-1
verdict: PASS

```command
cat packages/brain/scripts/coding-workflow/lib/review.mjs; ls packages/brain/scripts/coding-workflow/__tests__/
```

```output
// 规格评审文档解析的纯函数：verdict 行 + `### R-n` 问题小节 → {verdict, issues, errors}。
import { parseFrontmatter } from './md-chain.mjs';

// 允许字段名加粗、整行加粗、全/半角冒号，大小写不敏感
const VERDICT_RE = /^\s*(?:\*\*)?verdict(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*([^*\s]*)\s*(?:\*\*)?\s*$/i;
const ISSUE_RE = /^### (R-\d+)(?:[\s:：].*)?$/;
const HEADING_RE = /^#{1,3}(?:\s|$)/;
const TARGET_RE = /^\s*(?:\*\*)?针对(?:\*\*)?\s*[:：]\s*(.*)$/;
const VERDICTS = ['APPROVE', 'REVISE'];
export function parseReview(text, { specIds = [], intentIds = [] } = {}) {
  return { verdict, issues, errors };
review.test.mjs
```

### E-2
对应: I-1
verdict: PASS

```command
cat > /tmp/probe-review-15cf.mjs <<'EOF'
import { parseReview } from '/Users/administrator/worktrees/cecelia-cw/cw-15cf9cad/packages/brain/scripts/coding-workflow/lib/review.mjs';
const ids = { specIds: ['S-1','S-2'], intentIds: ['I-1'] };
const cases = {
  approve_plain: 'verdict: APPROVE\n',
  approve_bold_lower: '**verdict**: approve\n',
  revise_ok: 'verdict: REVISE\n\n### R-1\n针对: S-1, I-1\n描述问题\n',
  missing: '无 verdict\n',
  invalid: 'verdict: MAYBE\n',
  revise_no_issue: 'verdict: REVISE\n',
  target_missing: 'verdict: REVISE\n### R-1\n只有描述\n',
  body_empty: 'verdict: REVISE\n### R-1\n针对: S-1\n',
  target_unknown: 'verdict: REVISE\n### R-1\n针对: S-9\n描述\n',
  approve_with_issue: 'verdict: APPROVE\n### R-1\n针对: S-2\n建议\n',
};
for (const [k, v] of Object.entries(cases)) {
  const r = parseReview(v, ids);
  console.log(k, JSON.stringify({ verdict: r.verdict, issues: r.issues.map(i => ({ id: i.id, targets: i.targets, body: i.body })), errors: r.errors }));
}
EOF
node /tmp/probe-review-15cf.mjs
```

```output
approve_plain {"verdict":"APPROVE","issues":[],"errors":[]}
approve_bold_lower {"verdict":"APPROVE","issues":[],"errors":[]}
revise_ok {"verdict":"REVISE","issues":[{"id":"R-1","targets":["S-1","I-1"],"body":"描述问题"}],"errors":[]}
```

### E-3
对应: I-2
verdict: PASS

```command
cat > /tmp/probe-review-15cf.mjs <<'EOF'
import { parseReview } from '/Users/administrator/worktrees/cecelia-cw/cw-15cf9cad/packages/brain/scripts/coding-workflow/lib/review.mjs';
const ids = { specIds: ['S-1','S-2'], intentIds: ['I-1'] };
const cases = {
  approve_plain: 'verdict: APPROVE\n',
  approve_bold_lower: '**verdict**: approve\n',
  revise_ok: 'verdict: REVISE\n\n### R-1\n针对: S-1, I-1\n描述问题\n',
  missing: '无 verdict\n',
  invalid: 'verdict: MAYBE\n',
  revise_no_issue: 'verdict: REVISE\n',
  target_missing: 'verdict: REVISE\n### R-1\n只有描述\n',
  body_empty: 'verdict: REVISE\n### R-1\n针对: S-1\n',
  target_unknown: 'verdict: REVISE\n### R-1\n针对: S-9\n描述\n',
  approve_with_issue: 'verdict: APPROVE\n### R-1\n针对: S-2\n建议\n',
};
for (const [k, v] of Object.entries(cases)) {
  const r = parseReview(v, ids);
  console.log(k, JSON.stringify({ verdict: r.verdict, issues: r.issues.map(i => ({ id: i.id, targets: i.targets, body: i.body })), errors: r.errors }));
}
EOF
node /tmp/probe-review-15cf.mjs
```

```output
missing {"verdict":null,"issues":[],"errors":["verdict_missing"]}
invalid {"verdict":null,"issues":[],"errors":["verdict_invalid"]}
revise_no_issue {"verdict":"REVISE","issues":[],"errors":["issues_missing"]}
target_missing {"verdict":"REVISE","issues":[{"id":"R-1","targets":[],"body":"只有描述"}],"errors":["R-1:target_missing"]}
body_empty {"verdict":"REVISE","issues":[{"id":"R-1","targets":["S-1"],"body":""}],"errors":["R-1:body_empty"]}
target_unknown {"verdict":"REVISE","issues":[{"id":"R-1","targets":["S-9"],"body":"描述"}],"errors":["R-1:target_unknown:S-9"]}
approve_with_issue {"verdict":"APPROVE","issues":[{"id":"R-1","targets":["S-2"],"body":"建议"}],"errors":[]}
```

### E-4
对应: I-3
verdict: PASS

```command
cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/review.test.mjs 2>&1 | tail -15
```

```output
 ✓ scripts/coding-workflow/__tests__/review.test.mjs  (22 tests) 3ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
```

### E-5
对应: I-3
verdict: PASS

```command
grep -nE "^\s*(it|test|describe)\(" /Users/administrator/worktrees/cecelia-cw/cw-15cf9cad/packages/brain/scripts/coding-workflow/__tests__/review.test.mjs
```

```output
65:  it('无 verdict 行 → verdict_missing', () => {
71:  it('verdict: MAYBE → verdict_invalid', () => {
77:  it('REVISE 无 R-n → issues_missing', () => {
81:  it('R-1 无针对行 → R-1:target_missing', () => {
87:  it('针对行切分后无 ID → target_missing', () => {
91:  it('R-2 仅有针对行无描述 → R-2:body_empty', () => {
97:  it('未知目标 ID → R-1:target_unknown:S-9', () => {
102:  it('APPROVE + 合法 R-1 → errors 为空', () => {
108:  it('APPROVE 不带 R-n → errors 为空', () => {
112:  it('REVISE + 合法 R-1（针对 S-1, I-1）→ errors 为空', () => {
```

### E-6
对应: I-4
verdict: PASS

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-15cf9cad/packages/brain && npx vitest run scripts/coding-workflow 2>&1 | tail -12
```

```output
 Test Files  29 passed (29)
      Tests  541 passed (541)
```
