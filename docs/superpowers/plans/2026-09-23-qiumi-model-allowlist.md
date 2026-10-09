# 秋米路由认「用 <型号>」Implementation Plan（含设计）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 正文写「用 grok-4.7」「用 opus-5」「用 sol」直接命中 OpenClaw 允许清单里的型号；「用 claude」不再映射到已判死的 claude-cli 通道。

**设计（主理人 0923 拍板，不得推翻）**
- 厂商 × 型号两层。型号清单不手抄：`QIUMI_MODEL_ALLOWLIST`（JSON 数组，值 = OpenClaw `agents.defaults.modelPolicy.allow` 原样，如 `"xai/grok-4.7"`），运维同步。
- 匹配：正文出现「用 <token>」，token 与清单按 **全名** 或 **短名** 命中。短名规则：`id.split('/')[1]` 等于 token，或以 `-<token>` 结尾（`sol`→`openai/gpt-5.6-sol`，`opus-5`→`anthropic/claude-opus-5`，`haiku-4-5`→`anthropic/claude-haiku-4-5`）。命中多个 → 视为不命中（不猜）。token 至少 3 个字符，字符集 `[A-Za-z0-9._/-]`。
- 命中 → `cheap.hardModel`（matchedBy `text:model`）→ agent 分支 `model = cheap.hardModel ?? env.modelMap[engine]`；事件 `qiumi_route_decided` 记 `hardModel`。engine 逻辑不变（Jev 仍答 engine，只影响默认）。
- `DEFAULT_MODEL_MAP.claude` 改为 `anthropic/claude-sonnet-5`（原 `claude-cli/claude-sonnet-5` 通道在 OpenClaw 里已判死，10:05 CST 另一会话已把 sonnet-5 运行时改成原生 API）。
- executor 不改：`payload.model` 已透传 `--model`，SAFE 正则允许 `/ . -`。
- 测试策略：unit 三文件先红后绿 + 变异；integration 无；E2E = 部署后 Notion 建「用 grok-4.7 …」等任务真跑。

**Global Constraints**：NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；每 Task 两段 commit；`git add` 按文件名；不碰版本五件套；不新建测试文件；固定测试命令 `cd packages/brain && npx vitest run src/routing/__tests__/env.test.js src/routing/__tests__/cheap-gates.test.js src/routing/__tests__/qiumi-router.test.js src/__tests__/openclaw-agent-executor.test.js`（禁全量）；bash-guard 拦 `sed -i` 改代码，用 Edit；commit 尾行 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。

---

### Task 0: env — 允许清单、resolveModelRef、claude 默认映射

**Files:** Modify `packages/brain/src/routing/env.js`；Test `packages/brain/src/routing/__tests__/env.test.js`（末尾追加）

- [ ] **Step 1 失败用例**

```js
import { qiumiEnv, resolveModelRef } from '../env.js';  // 若文件已 import qiumiEnv，只补 resolveModelRef

describe('QIUMI_MODEL_ALLOWLIST + resolveModelRef', () => {
  const env = qiumiEnv({ QIUMI_MODEL_ALLOWLIST: JSON.stringify([
    'openai/gpt-5.6-terra', 'openai/gpt-5.6-sol', 'anthropic/claude-opus-5', 'anthropic/claude-opus-5-5',
    'anthropic/claude-haiku-4-5', 'anthropic/claude-haiku-4-5-20251001', 'xai/grok-4.7', 'xai/grok-4.20-reasoning',
  ]) });
  it('缺失/非法 JSON → 空清单', () => {
    expect(qiumiEnv({}).modelAllowlist).toEqual([]);
    expect(qiumiEnv({ QIUMI_MODEL_ALLOWLIST: '{bad' }).modelAllowlist).toEqual([]);
  });
  it('全名命中', () => expect(resolveModelRef('xai/grok-4.7', env)).toBe('xai/grok-4.7'));
  it('短名 = split 后全等：grok-4.7 / grok-4.20-reasoning', () => {
    expect(resolveModelRef('grok-4.7', env)).toBe('xai/grok-4.7');
    expect(resolveModelRef('grok-4.20-reasoning', env)).toBe('xai/grok-4.20-reasoning');
  });
  it('短名 = 以 -token 结尾：sol → gpt-5.6-sol，opus-5 → claude-opus-5（不误吞 opus-5-5）', () => {
    expect(resolveModelRef('sol', env)).toBe('openai/gpt-5.6-sol');
    expect(resolveModelRef('opus-5', env)).toBe('anthropic/claude-opus-5');
    expect(resolveModelRef('opus-5-5', env)).toBe('anthropic/claude-opus-5-5');
  });
  it('多个候选（haiku-4-5 同时结尾匹配两条）→ 优先全等短名；无全等且多候选 → null', () => {
    expect(resolveModelRef('haiku-4-5', env)).toBe('anthropic/claude-haiku-4-5');
    const env2 = qiumiEnv({ QIUMI_MODEL_ALLOWLIST: JSON.stringify(['a/x-pro', 'b/y-pro']) });
    expect(resolveModelRef('pro', env2)).toBeNull();
  });
  it('不在清单 / 太短 / 空 → null', () => {
    expect(resolveModelRef('claude', env)).toBeNull();
    expect(resolveModelRef('so', env)).toBeNull();
    expect(resolveModelRef('', env)).toBeNull();
  });
  it('claude 引擎默认映射改为 anthropic 原生通道', () => {
    expect(qiumiEnv({}).modelMap.claude).toBe('anthropic/claude-sonnet-5');
  });
});
```

- [ ] **Step 2 跑红 → commit-1** `test(brain): 秋米模型允许清单 + resolveModelRef + claude 原生映射（红）`

- [ ] **Step 3 实现**

`DEFAULT_MODEL_MAP.claude` 改为 `'anthropic/claude-sonnet-5'`（注释：claude-cli 通道 0923 判死，债 419ab185）。`qiumiEnv` 返回对象加：

```js
    modelAllowlist: (() => { const v = parseJson(env.QIUMI_MODEL_ALLOWLIST, []); return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.includes('/')) : []; })(),
```

文件头注释表补 `QIUMI_MODEL_ALLOWLIST  JSON 数组，OpenClaw agents.defaults.modelPolicy.allow 原样；正文「用 <型号>」只认清单内`。末尾导出：

```js
/** 「用 <token>」→ 允许清单里的完整型号 id；全名 > 短名全等 > 以 -token 结尾（唯一才算），否则 null。 */
export function resolveModelRef(token, env = qiumiEnv()) {
  const t = String(token ?? '').trim();
  if (t.length < 3) return null;
  const list = env.modelAllowlist ?? [];
  if (list.includes(t)) return t;
  const short = (id) => id.slice(id.indexOf('/') + 1);
  const exact = list.filter((id) => short(id) === t);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const suffix = list.filter((id) => short(id).endsWith(`-${t}`));
  return suffix.length === 1 ? suffix[0] : null;
}
```

- [ ] **Step 4 全绿 → commit-2** `feat(brain): 秋米模型允许清单 QIUMI_MODEL_ALLOWLIST + resolveModelRef；claude 引擎改走 anthropic 原生通道`

---

### Task 1: 便宜闸「用 <型号>」→ hardModel

**Files:** Modify `packages/brain/src/routing/cheap-gates.js`；Test `packages/brain/src/routing/__tests__/cheap-gates.test.js`（在 `describe('cheapGates')` 内追加；先看该文件 `task()`/`pool` 的既有 helper 名，照用）

- [ ] **Step 1 失败用例**

```js
  describe('「用 <型号>」→ hardModel（清单内才认）', () => {
    const envM = qiumiEnv({ QIUMI_MODEL_ALLOWLIST: JSON.stringify(['xai/grok-4.7', 'openai/gpt-5.6-sol', 'anthropic/claude-opus-5']) });
    it('用 grok-4.7 → hardModel xai/grok-4.7，matchedBy 含 text:model', () => {
      const out = cheapGates(task('这个活用 grok-4.7 跑'), pool, envM);
      expect(out.hardModel).toBe('xai/grok-4.7');
      expect(out.matchedBy).toContain('text:model');
    });
    it('用 sol / 用 opus-5 → 短名命中', () => {
      expect(cheapGates(task('用 sol 做'), pool, envM).hardModel).toBe('openai/gpt-5.6-sol');
      expect(cheapGates(task('让 dev 用 opus-5 写'), pool, envM).hardModel).toBe('anthropic/claude-opus-5');
    });
    it('用 claude → 仍是 hardEngine claude，hardModel null（引擎词不是型号）', () => {
      const out = cheapGates(task('用 claude 做'), pool, envM);
      expect(out.hardEngine).toBe('claude');
      expect(out.hardModel).toBeNull();
    });
    it('清单外 用 foo-bar → hardModel null；清单为空 → 永不命中', () => {
      expect(cheapGates(task('用 foo-bar 做'), pool, envM).hardModel).toBeNull();
      expect(cheapGates(task('用 grok-4.7 做'), pool, env).hardModel).toBeNull();
    });
    it('正文里多个「用 X」取第一个命中的', () => {
      expect(cheapGates(task('用 nothing 先，再用 sol'), pool, envM).hardModel).toBe('openai/gpt-5.6-sol');
    });
  });
```

`task()` 若既有 helper 签名不同（如需 payload.qiumi_source），照既有写法构造，正文放进 body。

- [ ] **Step 2 跑红 → commit-1** `test(brain): 便宜闸认「用 <型号>」（红）`

- [ ] **Step 3 实现** `cheap-gates.js`：import `resolveModelRef`（`import { resolveModelRef } from './env.js'`）；`out` 初始加 `hardModel: null`；在 ENGINE_RES 循环之前加：

```js
  // 「用 <型号>」：只认 QIUMI_MODEL_ALLOWLIST 里的（全名或短名），第一个命中即定案。
  const MODEL_RE = /用\s*([A-Za-z][A-Za-z0-9._\/-]{2,})/g;
  for (const m of text.matchAll(MODEL_RE)) {
    const ref = resolveModelRef(m[1], env);
    if (ref) { out.hardModel = ref; out.matchedBy.push('text:model'); break; }
  }
```

- [ ] **Step 4 全绿；变异：把 `break` 后的赋值删掉 → 第 1 条红；还原 → commit-2** `feat(brain): 便宜闸认「用 <型号>」→ hardModel（只认允许清单）`

---

### Task 2: 路由 agent 分支用 hardModel

**Files:** Modify `packages/brain/src/routing/qiumi-router.js`；Test `packages/brain/src/routing/__tests__/qiumi-router.test.js`（末尾追加；`envDefault` 已存在；需要一个带清单的 env）

- [ ] **Step 1 失败用例**

```js
describe('「用 <型号>」→ agent 分支 model 取 hardModel', () => {
  const envModel = qiumiEnv({ JEV_API_KEY: 'k', QIUMI_MODEL_ALLOWLIST: JSON.stringify(['xai/grok-4.7', 'anthropic/claude-opus-5']) });
  it('用 grok-4.7 → payloadPatch.model=xai/grok-4.7，事件 hardModel 留痕，engine 仍按 Jev', async () => {
    const d = await routeQiumiTask(task('写周报，用 grok-4.7'), { pool, env: envModel, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d.outcome).toBe('agent');
    expect(d.model).toBe('xai/grok-4.7');
    expect(d.payloadPatch.model).toBe('xai/grok-4.7');
    expect(d.payloadPatch.qiumi_route.cheap.hardModel).toBe('xai/grok-4.7');
    expect(recordTaskEventSafe).toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_decided', expect.objectContaining({ outcome: 'agent', model: 'xai/grok-4.7' }));
  });
  it('没写型号 → 仍走 modelMap[engine]（terra）', async () => {
    const d = await routeQiumiTask(task('写周报'), { pool, env: envModel, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d.payloadPatch.model).toBe('openai/gpt-5.6-terra');
  });
  it('用 claude（引擎词）→ model = anthropic/claude-sonnet-5（原生通道，不再 claude-cli）', async () => {
    const d = await routeQiumiTask(task('用 claude 写周报'), { pool, env: envModel, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d.payloadPatch.model).toBe('anthropic/claude-sonnet-5');
  });
});
```

- [ ] **Step 2 跑红 → commit-1** `test(brain): 路由 agent 分支采用「用 <型号>」hardModel（红）`

- [ ] **Step 3 实现** `qiumi-router.js`：`base.cheap` 加 `hardModel: cheap.hardModel ?? null`；agent 分支 `const model = env.modelMap[engine];` 改为 `const model = cheap.hardModel ?? env.modelMap[engine];`。

- [ ] **Step 4 全绿；变异：改回 `env.modelMap[engine]` → 第 1 条红；还原 → commit-2** `feat(brain): 路由 agent 分支采用「用 <型号>」hardModel`

---

### Task 3: 碎片（lead 自做）

`changes/cp-0923210826-qiumi-model-allowlist.md`。

## Self-Review
设计四点 → Task 0（清单/解析/claude 映射）、Task 1（便宜闸）、Task 2（路由）；executor 不改（已透传）。无占位符。
