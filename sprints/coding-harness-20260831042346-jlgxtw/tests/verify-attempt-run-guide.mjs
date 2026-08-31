import { readFileSync } from 'node:fs';

const docPath = 'docs/current/attempt-run-bridge-guide.md';
const text = readFileSync(docPath, 'utf8');
const mode = process.argv[2] ?? 'all';

const checks = {
  endpoints: [
    'POST /api/brain/harness/attempt-run',
    'GET /api/brain/harness/attempt-run/:id',
    'internalAuthOrLoopback',
    'Authorization: Bearer $CECELIA_INTERNAL_TOKEN',
    '宿主',
    '远端',
  ],
  roles: [
    '九项', 'canary', 'planner', 'proposer', 'reviewer', 'generator',
    'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge',
  ],
  payload: ['sprint_dir', 'base_repo', 'branch', 'base_sha', '可省略', '生产 Brain'],
  rollback: ['派发失败', '自动回滚', 'run → failed', 'session → closed', 'task → cancelled'],
};

function assertGroup(name) {
  for (const expected of checks[name]) {
    if (!text.includes(expected)) throw new Error(`${name} 缺少：${expected}`);
  }
  console.log(`OK ${name}`);
}

if (mode === 'all') {
  if (!/[\u3400-\u9fff]/u.test(text)) throw new Error('文档必须包含中文');
  for (const name of Object.keys(checks)) assertGroup(name);
  console.log('OK all');
} else if (Object.hasOwn(checks, mode)) {
  assertGroup(mode);
} else {
  throw new Error(`未知校验模式：${mode}`);
}

