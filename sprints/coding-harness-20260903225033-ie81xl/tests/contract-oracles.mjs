import fs from 'node:fs';

const file = 'docs/current/attempt-run-bridge-guide.md';
const mode = process.argv[2] ?? 'all';
const text = fs.readFileSync(file, 'utf8');
const section = (name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  if (!match) throw new Error(`缺少独立章节: ${name}`);
  return match[1];
};
const requireAll = (body, values, label) => {
  for (const value of values) if (!body.includes(value)) throw new Error(`${label} 缺少: ${value}`);
};
const reject = (body, pattern, label) => {
  if (pattern.test(body)) throw new Error(`${label} 命中禁止表述: ${pattern}`);
};

const checks = {
  chinese() {
    if (!/^# attempt-run 桥接使用说明$/m.test(text)) throw new Error('缺少中文页面标题');
    if (!/[\u4e00-\u9fff]/.test(text)) throw new Error('页面不是中文');
    console.log('P5 PASS: 中文说明页');
  },
  'endpoint-auth'() {
    const body = section('端点用途与鉴权');
    requireAll(body, ['POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id', 'internalAuthOrLoopback', 'Bearer', 'CECELIA_INTERNAL_TOKEN'], 'P1');
    reject(body, /(远端|宿主).{0,12}(无需|不需要|可以不).{0,8}(鉴权|Bearer)|Bearer\s+[A-Za-z0-9._-]{24,}/, 'N1');
    console.log('P1/N1 PASS: 端点与鉴权');
  },
  roles() {
    const body = section('角色白名单');
    const roles = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    requireAll(body, roles.map((x) => `- \`${x}\``), 'P2');
    if (!body.includes('角色白名单恰好 9 项')) throw new Error('P2 缺少恰好 9 项声明');
    reject(body, /`(?:commander|publisher)`|(?:角色|白名单)[^\n]{0,20}(?:等|等等)/, 'N2');
    console.log('P2/N2 PASS: 九角色封闭枚举');
  },
  payload() {
    const body = section('payload 字段');
    requireAll(body, ['- `sprint_dir`', '- `base_repo`', '- `branch`', 'payload 必填字段恰好 3 项', '`base_sha` 可省略', '由生产 Brain 自解析'], 'P3');
    reject(body, /`base_sha`.{0,12}(必填|必须提供|调用方解析)/, 'N3');
    console.log('P3/N3 PASS: payload 字段');
  },
  rollback() {
    const body = section('派发失败自动回滚');
    requireAll(body, ['- `run→failed`', '- `session→closed`', '- `task→cancelled`', '自动回滚结果恰好 3 项'], 'P4');
    reject(body, /调用方.{0,12}(手工|手动|自行).{0,8}(修补|回滚|更新)/, 'N4');
    console.log('P4/N4 PASS: 自动回滚');
  },
};

if (mode === 'all') Object.values(checks).forEach((check) => check());
else if (checks[mode]) checks[mode]();
else throw new Error(`unknown oracle mode: ${mode}`);
