// B4 oracle：越界检查 —— 三点 diff（origin/main...HEAD），禁用工作区 diff（[自报对账] 同旨）
const { execSync } = require('child_process');
let out;
try {
  out = execSync('git diff --name-status origin/main...HEAD', { encoding: 'utf8' });
} catch (e) {
  console.error('FAIL: git diff origin/main...HEAD 不可用，越界检查不得跳过');
  process.exit(1);
}
const rows = out
  .trim()
  .split(/\n/)
  .filter(Boolean)
  .map((l) => {
    const seg = l.split(/\t/);
    return { st: seg[0], path: seg[seg.length - 1] };
  });
const forbidden = rows.filter(
  (r) =>
    r.path.startsWith('packages/brain/') ||
    r.path.startsWith('migrations/') ||
    r.path.startsWith('.github/workflows/')
);
if (forbidden.length) {
  console.error('FAIL: 越界改动 ' + JSON.stringify(forbidden));
  process.exit(1);
}
const modTests = rows.filter(
  (r) => r.st[0] !== 'A' && /(\.test\.|\.spec\.|__tests__\/)/.test(r.path)
);
if (modTests.length) {
  console.error('FAIL: 修改/删除了现有测试 ' + JSON.stringify(modTests));
  process.exit(1);
}
const doc = rows.find(
  (r) => r.path === 'docs/fire-drills/kernel-v1-mixed-20260724.md' && r.st[0] === 'A'
);
if (!doc) {
  console.error('FAIL: diff 中未新增 docs/fire-drills/kernel-v1-mixed-20260724.md');
  process.exit(1);
}
console.log('OK');
