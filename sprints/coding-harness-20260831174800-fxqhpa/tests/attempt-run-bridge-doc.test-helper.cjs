const fs = require('node:fs');

const docPath = 'docs/current/attempt-run-bridge-guide.md';
const mode = process.argv[2] || 'all';
if (!fs.existsSync(docPath)) throw new Error(`缺少文档：${docPath}`);
const text = fs.readFileSync(docPath, 'utf8');

const checks = {
  endpoints() {
    for (const value of [
      'POST /api/brain/harness/attempt-run',
      'GET /api/brain/harness/attempt-run/:id',
      'internalAuthOrLoopback',
      'Authorization: Bearer',
      'CECELIA_INTERNAL_TOKEN',
    ]) if (!text.includes(value)) throw new Error(`端点与鉴权缺少：${value}`);
  },
  roles() {
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    for (const role of roles) if (!text.includes(`\`${role}\``)) throw new Error(`角色白名单缺少：${role}`);
    if (!/白名单之外|名单外/.test(text) || !/拒绝/.test(text)) throw new Error('未说明白名单外角色会被拒绝');
  },
  payload() {
    for (const field of ['sprint_dir', 'base_repo', 'branch', 'base_sha']) {
      if (!text.includes(`\`${field}\``)) throw new Error(`payload 说明缺少：${field}`);
    }
    if (!/base_sha[^\n]*(可省略|省略)/.test(text) || !/生产 Brain[^\n]*(自解析|解析)/.test(text)) {
      throw new Error('未说明 base_sha 可省略并由生产 Brain 自解析');
    }
  },
  rollback() {
    for (const pattern of [/run\s*(?:→|->)\s*`?failed`?/, /session\s*(?:→|->)\s*`?closed`?/, /task\s*(?:→|->)\s*`?cancelled`?/]) {
      if (!pattern.test(text)) throw new Error(`回滚映射缺少：${pattern}`);
    }
  },
};

if (mode === 'all') Object.values(checks).forEach((check) => check());
else if (checks[mode]) checks[mode]();
else throw new Error(`未知检查模式：${mode}`);
console.log(`OK: ${mode}`);

