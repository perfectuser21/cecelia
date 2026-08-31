const fs = require('node:fs');

const docPath = 'docs/current/attempt-run-bridge-guide.md';
const mode = process.argv[2] || 'all';
if (!fs.existsSync(docPath)) throw new Error(`缺少文档：${docPath}`);
const text = fs.readFileSync(docPath, 'utf8');

const requiredSections = [
  '端点用途与鉴权',
  '角色白名单',
  'payload 必填字段',
  '派发失败自动回滚',
];

function section(title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'm'));
  if (!match || !match[1].trim()) throw new Error(`缺少独立章节或章节为空：${title}`);
  return match[1];
}

const checks = {
  chinese() {
    const hanCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    if (hanCount < 100) throw new Error(`简体中文正文不足：仅 ${hanCount} 个汉字`);
    const traditional = ['說明', '鑑權', '遠端', '必須', '派發', '失敗', '關閉', '取消'];
    const found = traditional.filter((word) => text.includes(word));
    if (found.length) throw new Error(`检测到繁体用词：${found.join('、')}`);
  },
  sections() {
    const headings = [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]);
    for (const title of requiredSections) {
      if (headings.filter((heading) => heading === title).length !== 1) {
        throw new Error(`章节必须且只能独立出现一次：${title}`);
      }
      section(title);
    }
  },
  endpoints() {
    const body = section('端点用途与鉴权');
    for (const value of [
      'POST /api/brain/harness/attempt-run',
      'GET /api/brain/harness/attempt-run/:id',
      'internalAuthOrLoopback',
      'Authorization: Bearer',
      'CECELIA_INTERNAL_TOKEN',
    ]) if (!body.includes(value)) throw new Error(`端点与鉴权章节缺少：${value}`);
  },
  roles() {
    const body = section('角色白名单');
    const expected = ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge'];
    const actual = [...body.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`角色白名单必须是精确封闭集合：actual=${JSON.stringify(actual)}`);
    }
    if (!/白名单之外|名单外/.test(body) || !/拒绝/.test(body)) throw new Error('未说明白名单外角色会被拒绝');
  },
  payload() {
    const body = section('payload 必填字段');
    for (const field of ['sprint_dir', 'base_repo', 'branch', 'base_sha']) {
      if (!body.includes(`\`${field}\``)) throw new Error(`payload 章节缺少：${field}`);
    }
    if (!/base_sha[^\n]*(可省略|省略)/.test(body) || !/生产 Brain[^\n]*(自解析|解析)/.test(body)) {
      throw new Error('未说明 base_sha 可省略并由生产 Brain 自解析');
    }
  },
  rollback() {
    const body = section('派发失败自动回滚');
    for (const pattern of [/run\s*(?:→|->)\s*`?failed`?/, /session\s*(?:→|->)\s*`?closed`?/, /task\s*(?:→|->)\s*`?cancelled`?/]) {
      if (!pattern.test(body)) throw new Error(`回滚章节映射缺少：${pattern}`);
    }
  },
};

if (mode === 'all') Object.values(checks).forEach((check) => check());
else if (checks[mode]) checks[mode]();
else throw new Error(`未知检查模式：${mode}`);
console.log(`OK: ${mode}`);
