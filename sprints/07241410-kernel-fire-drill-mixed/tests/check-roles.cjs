// B3 oracle：六角色证据段结构 + role_assignments 对照字面（从仓库根执行）
const fs = require('fs');
const DOC = 'docs/fire-drills/kernel-v1-mixed-20260724.md';
let c;
try {
  c = fs.readFileSync(DOC, 'utf8');
} catch (e) {
  console.error('FAIL: 文件不存在 ' + DOC);
  process.exit(1);
}
const roles = ['planner', 'proposer', 'reviewer', 'generator', 'evaluator', 'judge'];
const parts = c.split(/^## role: /m).slice(1);
const seen = new Map(parts.map((p) => [p.split(/\r?\n/)[0].trim(), p]));
for (const r of roles) {
  const s = seen.get(r);
  if (!s) {
    console.error('FAIL: 缺角色段 ' + r);
    process.exit(1);
  }
  for (const f of ['- provider: ', '- account: ', '- evidence: ']) {
    if (!s.includes(f)) {
      console.error('FAIL: ' + r + ' 段缺 ' + f.trim() + ' 行');
      process.exit(1);
    }
  }
}
const assignments = [
  'planner=claude/account1',
  'proposer=claude/account1',
  'reviewer=grok/grok',
  'generator=codex/team3',
  'evaluator=claude/account2',
];
for (const a of assignments) {
  if (!c.includes(a)) {
    console.error('FAIL: 缺 role_assignments 对照字面 ' + a);
    process.exit(1);
  }
}
console.log('OK');
