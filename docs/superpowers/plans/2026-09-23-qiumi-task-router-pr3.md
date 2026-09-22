# 秋米任务路由 PR3 路由执行刀 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `qiumi_task` 在 Brain tick 派发前经「便宜闸 → Jev 判定」得到路由决策；设备任务事务内改为 `device_job` 交给有锁领单器；非设备任务由 Brain 经 ssh 在 MMV 起 `openclaw agent --model`，收割 `.exit` 落 `completed_no_pr`/`failed`；提供幂等切换脚本退役 us-vps 旧 cron。

**Architecture:** 新模块 `src/routing/{jev-client,cheap-gates,qiumi-router}.js`（纯函数 + 注入 fetch/query/now），在 `src/dispatcher.js` 的 `applyDispatchAllocationGuide` 之前对 `task_type='qiumi_task'` 做一次决策并持久化到 payload；执行体 `src/openclaw-agent-executor.js` 挂在 `executor.js triggerCeceliaRun` 的 internal handler 之后（0.7 分支），复用 `notion-push-sync.js` 已验证的 nohup/.exit/.log 约定 + prompt 走 stdin；收割 `reapOpenclawAgentRuns` 挂 `scheduler-jobs`；切换脚本 `scripts/ops/qiumi-cutover.sh` 幂等。Jev 输出 schema 按决策 df67a9d6（kind/is_device/engine/department/account/workflow_ref）设计，不新增任何 类型→skill/显示名/角色 手抄映射。

**Tech Stack:** Node ESM、vitest（fake timers、fetch/execFile stub）、Postgres（cecelia_test 真库 smoke）、ssh（execFile 数组形式，`SSH_BASE_ARGS`）、TypeSafe Jev HTTP API、OpenClaw CLI（MMV `/opt/homebrew/bin/openclaw`）。

## Global Constraints

- 工作目录 `/Users/administrator/worktrees/cecelia-scan-main/qiumi-pr3-routing`（分支 `cp-0923043454-qiumi-pr3-routing`，叠在 PR2 头 `e4b7c5e74`）。**开工前先 rebase 到 PR2 完整头**（PR2 Task 2–6 落地后），再 rebase 到 PR1 终审修复后的头（含 `lib/ssh-args.js`）。vitest：`cd packages/brain && npx vitest run <path> 2>&1 | tail -30`。禁止本机全量 `npm test`（低内存被杀，CI 把关）。禁止真 ssh、禁碰生产库（只允许 `cecelia_test`）。
- TDD 两段 commit：commit-1 只含失败测试（FAIL 片段进 commit body），commit-2 实现转绿。commit 中文，末尾单独一行 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。`git add` 只加具体文件（禁 `-A`/`.`；`.superpowers/` 不提交）。守卫变异测试（每个 Task 的 Step 7）。
- 主理人裁决（decisions df67a9d6 / bb6a3b82 / 9e65a514）：任务模型收敛为 `kind∈{agent,workflow}` + 属性 `{department, skill|workflow_ref, engine, device}`；**Jev 输出 schema 按此设计**；写死的 类型→skill/显示名/角色 映射表**不再新增消费**；角色即 department。
- 设备判定 fail-closed：注册表/字段命中为主 > Jev 补判；`is_device` 置信 `<0.8` 或序列号无法解析 → 不派，`failed` + `error_message` 写原因（中文表由 PR2 回写「推迟」）。**绝不**让设备任务掉进 openclaw-agent 直跑通道。
- 判定兜底只兜"判定"：Jev `3000ms` 超时/非 2xx → 重试 1 次 → terra（`callLLM` provider `openai` model `QIUMI_FALLBACK_MODEL`，20000ms）→ 重试 1 次 → `failed`（`error_message='qiumi_router_unavailable'`）。**绝不跳过判定执行。**
- Jev 输入 = `qiumi_source` 的标题+备注+正文全文（不截断），`redactSecrets()` 打码 `key/token/secret/password/bearer/sk-…` 模式；账号只能取 registry 池内值（池外 → 视为未选）。
- MMV 非设备 `openclaw-agent` 并发上限 `QIUMI_MMV_CONCURRENCY`（默认 2，机器闸非租户）：`SELECT count(*) FROM tasks WHERE executor_kind='openclaw-agent' AND status='in_progress'` ≥ 上限 → 释放 claim、`dispatched:false reason:'openclaw_agent_pool_full'`（照 `codex_pool_full` 写法）。
- us-vps 只调度不执行（96054a8b / eb0a03df）：执行只经 ssh 到 `sshTargetFor('us-mac-m4')`（`administrator@100.71.151.105`），`execFile('ssh', [...SSH_BASE_ARGS, target, remote], { input: prompt })`，prompt 走 stdin 不拼命令行。
- 与 PR2 接口（不得改语义）：入账 payload 含 `qiumi_source`（title/remark/body/priority_raw/due_at/channel/relations{agents,workflows,skills}/owner/zh_page_id/en_page_id/origin）、`dedup_by_notion_page='true'`、`notion_zh_page_id`、`tenant_id`、`headed_manual`；`executor_kind='openclaw-agent'`；急停语义 `owner_hold`/`cancel_requested`；开关 `QIUMI_SYNC_ENABLED`/`QIUMI_SYNC_SINCE`。PR3 新增开关 `QIUMI_DISPATCH_ENABLED`：PR2 的 `ingestQiumiPage` 改为 `headed_manual: env.QIUMI_DISPATCH_ENABLED !== 'true'`；切换脚本对存量 `queued` 的 `qiumi_task` 执行 `payload - 'headed_manual'`。
- 每步留痕 `task_events`（0f8309e8）：`recordTaskEventSafe(pool, taskId, 'qiumi_route_decided'|'qiumi_route_failed'|'qiumi_device_converted'|'openclaw_agent_spawned'|'openclaw_agent_reaped', payload)`。
- 派发时必须写 `payload.run_id`（`qiumi-<task_id 前 8 位>-<Date.now()>`，正则 `^[A-Za-z0-9._-]+$`），PR1 合同 probe 靠它探 `~/brain-runs/<run_id>.exit|.pid`。
- env（容器 env，改了必须重建容器，learning cp-0916213853；brain 无 env 登记机制，本刀在 `src/routing/env.js` 集中读取并在文件头列全）：`JEV_API_KEY`（1Password「Jev API Key (TypeSafe)」）、`JEV_ENDPOINT`（默认 `https://api.typesafe.ai/v1/systemone`）、`JEV_MODEL`（默认 `jev-latest`）、`QIUMI_FALLBACK_MODEL`（默认 `gpt-5.6-terra`）、`QIUMI_MMV_CONCURRENCY`（默认 2）、`QIUMI_DISPATCH_ENABLED`（默认 false）、`QIUMI_DEPARTMENTS`（JSON 数组，默认 `["main","infra","dev","media","people","fde"]`）、`QIUMI_MODEL_MAP`（JSON，默认 `{"claude":"claude-cli/claude-sonnet-5","codex":"openai/gpt-5.3-codex","terra":"openai/gpt-5.6-terra"}`）、`QIUMI_DEVICE_KEYWORDS`（JSON 数组，默认 `["手机","点赞","发布","朋友圈","抖音","adb","私信","小红书","快手","视频号"]`）、`QIUMI_JEV_STUB`/`QIUMI_SSH_STUB`（仅测试/smoke）。
- 新 smoke 登记 `packages/quality/smoke-allowlist.txt`（字母序）；库名+host 守卫照 `qiumi-foundation-smoke.sh:14-29`。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/brain/src/routing/env.js`（新） | 集中读取上表 env，导出 `qiumiEnv(env=process.env)` 纯函数 |
| `packages/brain/src/routing/redact.js`（新） | `redactSecrets(text)` |
| `packages/brain/src/routing/jev-client.js`（新） | `buildJevQuestions(ctx)`、`askJev(state, questions, deps)`、`askTerra(state, questions, deps)`、`decideWithFallback(...)` |
| `packages/brain/src/routing/cheap-gates.js`（新） | `loadRegistryPool(query)`、`cheapGates(task, pool)` → `{ isDevice, serial, workflowRef, department, hardEngine, matchedBy }` |
| `packages/brain/src/routing/qiumi-router.js`（新） | `routeQiumiTask(task, deps)` 决策合成 + 留痕 + 持久化 payload/device 转换 |
| `packages/brain/src/dispatcher.js`（改） | `applyDispatchAllocationGuide` 之前插 `qiumi_task` 路由与并发闸 |
| `packages/brain/src/openclaw-agent-executor.js`（新） | `triggerOpenclawAgent(task, deps)`、`reapOpenclawAgentRuns(pool, deps)` |
| `packages/brain/src/executor.js`（改） | `triggerCeceliaRun` 0.7 分支 |
| `packages/brain/src/scheduler-jobs.js`（改） | 新 job `openclaw-agent-reaper` |
| `packages/brain/src/notion-gtd-sync.js`（改，PR2 产物） | `ingestQiumiPage` 的 `headed_manual` 受 `QIUMI_DISPATCH_ENABLED` 控制 |
| `packages/brain/scripts/ops/qiumi-cutover.sh`（新）+ `qiumi-inflight-check.mjs`（新） | 幂等切换 + 在途检查 |
| `packages/brain/scripts/smoke/qiumi-routing-smoke.sh` + `.mjs`（新） | cecelia_test 真库 smoke（stub Jev/ssh） |
| `packages/quality/smoke-allowlist.txt`（改） | 登记 |
| 测试：`src/__tests__/qiumi-jev-client.test.js`、`qiumi-cheap-gates.test.js`、`qiumi-router.test.js`、`dispatcher-qiumi-routing.test.js`、`openclaw-agent-executor.test.js`、`scheduler-jobs-openclaw-reaper.test.js`、`qiumi-cutover-guard.test.js` | |

---

### Task 1: `routing/env.js` + `routing/redact.js` + `routing/jev-client.js`

**Files:**
- Create: `packages/brain/src/routing/env.js`、`packages/brain/src/routing/redact.js`、`packages/brain/src/routing/jev-client.js`
- Test: `packages/brain/src/__tests__/qiumi-jev-client.test.js`

**Interfaces:**
- Consumes: `callLLM(agentId, prompt, { provider, model, timeout, maxTokens })`（`llm-caller.js:136`）
- Produces:
  - `qiumiEnv(env) → { jevApiKey, jevEndpoint, jevModel, fallbackModel, mmvConcurrency, dispatchEnabled, departments, modelMap, deviceKeywords, jevStub, sshStub }`
  - `redactSecrets(text) → string`
  - `buildJevQuestions({ departments, accountPool, workflowPool }) → questions`
  - `decideWithFallback({ state, questions, env, fetchFn, callLLMFn, now }) → { source:'jev'|'terra', answers, latencyMs } | { source:'fail', reason }`
  - answers 形状（统一）：`{ kind:{choice,confidence}, is_device:{choice:'true'|'false',confidence}, engine:{choice,confidence}, department:{choice,confidence}, account:{choice,confidence}|null, workflow_ref:{choice,confidence}|null }`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/qiumi-jev-client.test.js
import { describe, it, expect, vi } from 'vitest';
import { qiumiEnv } from '../routing/env.js';
import { redactSecrets } from '../routing/redact.js';
import { buildJevQuestions, decideWithFallback } from '../routing/jev-client.js';

const okJev = (overrides = {}) => ({
  ok: true, status: 200,
  json: async () => ({
    model: 'jev-1.13.0',
    answers: {
      kind: { type: 'choice', choice: 'agent', confidence: 0.99 },
      is_device: { type: 'noul', choice: 'false', confidence: 0.97 },
      engine: { type: 'choice', choice: 'claude', confidence: 1.0 },
      department: { type: 'choice', choice: 'dev', confidence: 0.9 },
      account: { type: 'choice', choice: 'not_applicable', confidence: 0.9 },
      workflow_ref: { type: 'choice', choice: 'not_applicable', confidence: 0.9 },
      ...overrides,
    },
    usage: { input_tokens: 400, output_tokens: 40 },
  }),
});

describe('qiumiEnv', () => {
  it('缺省值与 JSON 解析', () => {
    const e = qiumiEnv({ JEV_API_KEY: 'k' });
    expect(e.jevEndpoint).toBe('https://api.typesafe.ai/v1/systemone');
    expect(e.jevModel).toBe('jev-latest');
    expect(e.fallbackModel).toBe('gpt-5.6-terra');
    expect(e.mmvConcurrency).toBe(2);
    expect(e.dispatchEnabled).toBe(false);
    expect(e.departments).toEqual(['main', 'infra', 'dev', 'media', 'people', 'fde']);
    expect(e.modelMap.claude).toBe('claude-cli/claude-sonnet-5');
    expect(e.deviceKeywords).toContain('朋友圈');
    expect(qiumiEnv({ QIUMI_MMV_CONCURRENCY: '3', QIUMI_DISPATCH_ENABLED: 'true', QIUMI_DEPARTMENTS: '["main"]' }))
      .toMatchObject({ mmvConcurrency: 3, dispatchEnabled: true, departments: ['main'] });
  });
});

describe('redactSecrets', () => {
  it('打码 key/token/密码/bearer/sk-，不动普通文本', () => {
    const s = redactSecrets('api_key=abc123 token: xyz Bearer eyJhbGci sk-live-999 密码：p@ss 正文照旧');
    expect(s).not.toMatch(/abc123|xyz|eyJhbGci|sk-live-999|p@ss/);
    expect(s).toContain('正文照旧');
    expect(s).toMatch(/\[REDACTED\]/);
  });
});

describe('buildJevQuestions', () => {
  it('六个问题：kind/is_device/engine/department/account/workflow_ref，池空则 not_applicable', () => {
    const q = buildJevQuestions({ departments: ['main', 'dev'], accountPool: ['ANGYVB4227006983'], workflowPool: ['朋友圈跟圈'] });
    expect(Object.keys(q)).toEqual(['kind', 'is_device', 'engine', 'department', 'account', 'workflow_ref']);
    expect(q.kind.criteria).toEqual({ agent: expect.any(String), workflow: expect.any(String) });
    expect(q.is_device.type).toBe('noul');
    expect(Object.keys(q.engine.criteria)).toEqual(['claude', 'codex', 'terra']);
    expect(Object.keys(q.department.criteria)).toEqual(['main', 'dev']);
    expect(Object.keys(q.account.criteria)).toEqual(['ANGYVB4227006983', 'not_applicable']);
    expect(Object.keys(q.workflow_ref.criteria)).toEqual(['朋友圈跟圈', 'not_applicable']);
  });
});

describe('decideWithFallback', () => {
  const env = qiumiEnv({ JEV_API_KEY: 'k' });
  const questions = buildJevQuestions({ departments: env.departments, accountPool: [], workflowPool: [] });

  it('Jev 200 → source=jev，请求带 Bearer 与 model，state 已打码', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okJev());
    const r = await decideWithFallback({ state: 'token: SECRET 用 Claude Code 做', questions, env, fetchFn, callLLMFn: vi.fn() });
    expect(r.source).toBe('jev');
    expect(r.answers.engine.choice).toBe('claude');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(env.jevEndpoint);
    expect(init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('jev-latest');
    expect(body.state).not.toContain('SECRET');
    expect(body.questions).toEqual(questions);
  });

  it('Jev 超时一次后成功 → 仍 source=jev，fetch 调 2 次', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(okJev());
    const r = await decideWithFallback({ state: 'x', questions, env, fetchFn, callLLMFn: vi.fn() });
    expect(r.source).toBe('jev');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('Jev 两次都挂 → terra 兜底（callLLM provider=openai model=fallbackModel timeout=20000），解析 JSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'down' });
    const callLLMFn = vi.fn().mockResolvedValue({ text: JSON.stringify({
      kind: { choice: 'agent', confidence: 0.8 }, is_device: { choice: 'false', confidence: 0.9 },
      engine: { choice: 'terra', confidence: 0.7 }, department: { choice: 'main', confidence: 0.6 },
      account: null, workflow_ref: null,
    }) });
    const r = await decideWithFallback({ state: 'x', questions, env, fetchFn, callLLMFn });
    expect(r.source).toBe('terra');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(callLLMFn).toHaveBeenCalledTimes(1);
    expect(callLLMFn.mock.calls[0][2]).toMatchObject({ provider: 'openai', model: 'gpt-5.6-terra', timeout: 20000 });
    expect(r.answers.engine.choice).toBe('terra');
  });

  it('terra 第一次回非 JSON、第二次 JSON → 重试 1 次成功', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    const callLLMFn = vi.fn()
      .mockResolvedValueOnce({ text: '不是 json' })
      .mockResolvedValueOnce({ text: JSON.stringify({ kind: { choice: 'agent', confidence: 0.9 }, is_device: { choice: 'false', confidence: 0.9 }, engine: { choice: 'codex', confidence: 0.9 }, department: { choice: 'dev', confidence: 0.9 }, account: null, workflow_ref: null }) });
    const r = await decideWithFallback({ state: 'x', questions, env, fetchFn, callLLMFn });
    expect(r.source).toBe('terra');
    expect(callLLMFn).toHaveBeenCalledTimes(2);
  });

  it('Jev 与 terra 全挂 → source=fail，绝不返回可执行决策', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const callLLMFn = vi.fn().mockRejectedValue(new Error('bridge down'));
    const r = await decideWithFallback({ state: 'x', questions, env, fetchFn, callLLMFn });
    expect(r).toEqual({ source: 'fail', reason: 'qiumi_router_unavailable' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(callLLMFn).toHaveBeenCalledTimes(2);
  });

  it('缺 JEV_API_KEY → 不调 Jev，直接 terra', async () => {
    const fetchFn = vi.fn();
    const callLLMFn = vi.fn().mockResolvedValue({ text: JSON.stringify({ kind: { choice: 'agent', confidence: 0.9 }, is_device: { choice: 'false', confidence: 0.9 }, engine: { choice: 'terra', confidence: 0.9 }, department: { choice: 'main', confidence: 0.9 }, account: null, workflow_ref: null }) });
    const r = await decideWithFallback({ state: 'x', questions, env: qiumiEnv({}), fetchFn, callLLMFn });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(r.source).toBe('terra');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/qiumi-jev-client.test.js 2>&1 | tail -20`
Expected: FAIL，`Cannot find module '../routing/env.js'`（或 redact/jev-client）。

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/qiumi-jev-client.test.js
git commit -m "test(brain): 秋米路由 Jev 客户端——env/打码/问题模板/Jev→terra→fail 阶梯（先红）

RED: Cannot find module '../routing/env.js'

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现 `routing/env.js`**

```js
// packages/brain/src/routing/env.js
/**
 * 秋米路由 env 集中读取（brain 无 env 登记机制，本文件即清单）：
 *  JEV_API_KEY            TypeSafe Jev key（1Password「Jev API Key (TypeSafe)」→ 容器 env）
 *  JEV_ENDPOINT           默认 https://api.typesafe.ai/v1/systemone
 *  JEV_MODEL              默认 jev-latest
 *  QIUMI_FALLBACK_MODEL   terra 兜底模型（callLLM provider=openai），默认 gpt-5.6-terra
 *  QIUMI_MMV_CONCURRENCY  MMV 非设备 openclaw-agent 并发上限（机器闸），默认 2
 *  QIUMI_DISPATCH_ENABLED 'true' 才允许 tick 派发 qiumi_task（PR2 入账不再写 headed_manual）
 *  QIUMI_DEPARTMENTS      JSON 数组，Jev department 选项（= openclaw agents 部门清单）
 *  QIUMI_MODEL_MAP        JSON，engine → `openclaw agent --model` 值
 *  QIUMI_DEVICE_KEYWORDS  JSON 数组，便宜闸设备关键词
 *  QIUMI_JEV_STUB / QIUMI_SSH_STUB  仅测试/smoke：JSON 决策 / 'ok'|'fail'
 * 改 env 必须重建容器（learning cp-0916213853）。
 */
const DEFAULT_DEPARTMENTS = ['main', 'infra', 'dev', 'media', 'people', 'fde'];
const DEFAULT_MODEL_MAP = {
  claude: 'claude-cli/claude-sonnet-5',
  codex: 'openai/gpt-5.3-codex',
  terra: 'openai/gpt-5.6-terra',
};
const DEFAULT_DEVICE_KEYWORDS = ['手机', '点赞', '发布', '朋友圈', '抖音', 'adb', '私信', '小红书', '快手', '视频号'];

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function qiumiEnv(env = process.env) {
  const conc = Number.parseInt(env.QIUMI_MMV_CONCURRENCY ?? '2', 10);
  return Object.freeze({
    jevApiKey: env.JEV_API_KEY || null,
    jevEndpoint: env.JEV_ENDPOINT || 'https://api.typesafe.ai/v1/systemone',
    jevModel: env.JEV_MODEL || 'jev-latest',
    fallbackModel: env.QIUMI_FALLBACK_MODEL || 'gpt-5.6-terra',
    mmvConcurrency: Number.isFinite(conc) && conc > 0 ? conc : 2,
    dispatchEnabled: env.QIUMI_DISPATCH_ENABLED === 'true',
    departments: parseJson(env.QIUMI_DEPARTMENTS, DEFAULT_DEPARTMENTS),
    modelMap: { ...DEFAULT_MODEL_MAP, ...parseJson(env.QIUMI_MODEL_MAP, {}) },
    deviceKeywords: parseJson(env.QIUMI_DEVICE_KEYWORDS, DEFAULT_DEVICE_KEYWORDS),
    jevStub: env.QIUMI_JEV_STUB || null,
    sshStub: env.QIUMI_SSH_STUB || null,
  });
}
```

- [ ] **Step 5: 实现 `routing/redact.js`**

```js
// packages/brain/src/routing/redact.js
// 正文全发给第三方判定器前打码（主理人拍板：全发但打码 key/token/密码）。只打值，不删行。
const PATTERNS = [
  /(?:api[_-]?key|token|secret|password|passwd|密码|口令)\s*[:=：]\s*\S+/gi,
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
  /\bsk-[A-Za-z0-9_-]{6,}/g,
  /\b(?:ghp|gho|ghs|xoxb|xoxp)_[A-Za-z0-9]{10,}/g,
];
export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const re of PATTERNS) out = out.replace(re, (m) => m.replace(/(\s*[:=：]\s*|\s+)\S+$/, '$1[REDACTED]'));
  return out;
}
```

- [ ] **Step 6: 实现 `routing/jev-client.js`**

```js
// packages/brain/src/routing/jev-client.js
/**
 * 判定阶梯（主理人拍板）：Jev 3s → 重试 1 次 → terra 20s → 重试 1 次 → fail。
 * 兜底只兜"判定"，绝不跳过判定去执行；fail 由 qiumi-router 落 failed。
 * Jev 请求/响应：POST {model, state, questions:{name:{type:choice|noul, instructions, criteria}}}
 *   → {answers:{name:{choice, confidence, probabilities}}, usage}
 */
import { redactSecrets } from './redact.js';

export const JEV_TIMEOUT_MS = 3000;
export const TERRA_TIMEOUT_MS = 20000;
const ENGINES = { claude: '正文明确要求用 Claude / Claude Code', codex: '正文明确要求用 Codex', terra: '没有明确指定引擎，走默认通用' };

export function buildJevQuestions({ departments, accountPool = [], workflowPool = [] }) {
  const listToCriteria = (arr, na) => Object.fromEntries([...arr.map((v) => [v, `选项 ${v}`]), [na, '不适用/无法确定']]);
  return {
    kind: { type: 'choice', instructions: '这是单个 agent 就能完成的活，还是要跑一条既定工作流？', criteria: { agent: '一次对话/一次执行就能交付', workflow: '需要按既定多步流程（如发布/采集/跟圈）执行' } },
    is_device: { type: 'noul', instructions: '这条任务是否需要操作真实手机/设备（adb、点赞、发布、私信等）？', criteria: { true: '需要碰真机', false: '不需要碰真机' } },
    engine: { type: 'choice', instructions: '该用哪个执行引擎？没有明确指定就选 terra', criteria: ENGINES },
    department: { type: 'choice', instructions: '该由哪个部门 agent 负责？', criteria: Object.fromEntries(departments.map((d) => [d, `部门 ${d}`])) },
    account: { type: 'choice', instructions: '若需设备/账号，用哪一个？只能从给定池中选，不确定选 not_applicable', criteria: listToCriteria(accountPool, 'not_applicable') },
    workflow_ref: { type: 'choice', instructions: '若 kind=workflow，对应哪条已登记工作流？否则 not_applicable', criteria: listToCriteria(workflowPool, 'not_applicable') },
  };
}

const NAMES = ['kind', 'is_device', 'engine', 'department', 'account', 'workflow_ref'];

function normalizeAnswers(raw) {
  const out = {};
  for (const n of NAMES) {
    const a = raw?.[n];
    if (!a || typeof a !== 'object' || a.choice == null) { out[n] = null; continue; }
    out[n] = { choice: String(a.choice), confidence: Number(a.confidence ?? 0) };
  }
  if (!out.kind || !out.is_device || !out.engine || !out.department) return null;
  return out;
}

async function askJevOnce({ state, questions, env, fetchFn }) {
  const res = await fetchFn(env.jevEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.jevApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.jevModel, state, questions }),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`jev_http_${res.status}`);
  const json = await res.json();
  const answers = normalizeAnswers(json?.answers);
  if (!answers) throw new Error('jev_schema_invalid');
  return answers;
}

function terraPrompt(state, questions) {
  return [
    '你是任务路由器。只输出一个 JSON 对象，不要任何解释。',
    '按下面 questions 的 criteria 逐题作答，每题形如 {"choice":"<选项>","confidence":0~1}；account/workflow_ref 无法确定填 null。',
    `questions=${JSON.stringify(questions)}`,
    `state=${JSON.stringify(state)}`,
  ].join('\n');
}

async function askTerraOnce({ state, questions, env, callLLMFn }) {
  const r = await callLLMFn('qiumi-router', terraPrompt(state, questions), { provider: 'openai', model: env.fallbackModel, timeout: TERRA_TIMEOUT_MS, maxTokens: 400 });
  const text = typeof r === 'string' ? r : r?.text;
  const m = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('terra_not_json');
  const answers = normalizeAnswers(JSON.parse(m[0]));
  if (!answers) throw new Error('terra_schema_invalid');
  return answers;
}

export async function decideWithFallback({ state, questions, env, fetchFn = globalThis.fetch, callLLMFn, now = Date.now }) {
  const t0 = now();
  const redacted = redactSecrets(state);
  if (env.jevApiKey) {
    for (let i = 0; i < 2; i++) {
      try { return { source: 'jev', answers: await askJevOnce({ state: redacted, questions, env, fetchFn }), latencyMs: now() - t0 }; } catch { /* 重试/降级 */ }
    }
  }
  for (let i = 0; i < 2; i++) {
    try { return { source: 'terra', answers: await askTerraOnce({ state: redacted, questions, env, callLLMFn }), latencyMs: now() - t0 }; } catch { /* 重试/失败 */ }
  }
  return { source: 'fail', reason: 'qiumi_router_unavailable' };
}
```

- [ ] **Step 7: 跑测试转绿 + 变异**

Run: `cd packages/brain && npx vitest run src/__tests__/qiumi-jev-client.test.js 2>&1 | tail -20` → Expected: `8 passed`。
变异：把 `decideWithFallback` 末尾 `return { source:'fail'...}` 改为返回 terra 默认答案 → 「全挂 → fail」用例必红；还原绿。把红/绿输出写进 commit body。

- [ ] **Step 8: commit-2**

```bash
git add packages/brain/src/routing/env.js packages/brain/src/routing/redact.js packages/brain/src/routing/jev-client.js
git commit -m "feat(brain): 秋米路由 Jev 客户端——六问 schema(kind/is_device/engine/department/account/workflow_ref)、打码、Jev 3s×2→terra 20s×2→fail 阶梯

GREEN: 8 passed；变异(全挂改返默认)→红，还原绿

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `routing/cheap-gates.js`（注册表命中 + 字段硬约束）

**Files:**
- Create: `packages/brain/src/routing/cheap-gates.js`
- Test: `packages/brain/src/__tests__/qiumi-cheap-gates.test.js`

**Interfaces:**
- Consumes: `task.payload.qiumi_source`（PR2）：`{ title, remark, body, channel, relations:{agents:[],workflows:[],skills:[]}, owner, zh_page_id, en_page_id, origin }`；`ops_agents(name, meta jsonb, notion_id)`、`ops_workflows(name, notion_id, meta)`；`qiumiEnv().deviceKeywords`
- Produces:
  - `loadRegistryPool(query) → { agents:[{name, serial, notionId}], workflows:[{name, notionId, channel}] }`（`meta.serial`/`meta.phone_serial` 任一为序列号；`meta.channel` 为 'device' 视为设备工作流）
  - `cheapGates(task, pool, env) → { isDevice:boolean, serial:string|null, workflowRef:string|null, department:string|null, hardEngine:'claude'|'codex'|'terra'|null, matchedBy:string[] }`
  - 优先级：relations.workflows/agents 命中（硬约束）> `channel` 非空 > 正文命中 registry 序列号/agent 名/workflow 名 > 关键词 > 无。`hardEngine`：正文正则 `/claude\s*code|用\s*claude/i`→claude、`/用\s*codex/i`→codex。

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/qiumi-cheap-gates.test.js
import { describe, it, expect, vi } from 'vitest';
import { loadRegistryPool, cheapGates } from '../routing/cheap-gates.js';
import { qiumiEnv } from '../routing/env.js';

const env = qiumiEnv({});
const pool = {
  agents: [{ name: 'phone-ANGYVB4227006983', serial: 'ANGYVB4227006983', notionId: 'a1' }, { name: 'infra', serial: null, notionId: 'a2' }],
  workflows: [{ name: '朋友圈跟圈', notionId: 'w1', channel: 'device' }, { name: '周报生成', notionId: 'w2', channel: null }],
};
const mk = (src) => ({ id: 't1', task_type: 'qiumi_task', payload: { qiumi_source: { title: '', remark: '', body: '', channel: null, relations: { agents: [], workflows: [], skills: [] }, ...src } } });

describe('loadRegistryPool', () => {
  it('从 ops_agents/ops_workflows 读池，序列号来自 meta.serial 或 meta.phone_serial', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ name: 'phone-X', meta: { serial: 'X1' }, notion_id: 'a' }, { name: 'infra', meta: {}, notion_id: 'b' }] })
      .mockResolvedValueOnce({ rows: [{ name: '朋友圈跟圈', meta: { channel: 'device' }, notion_id: 'w' }] });
    const p = await loadRegistryPool(query);
    expect(p.agents).toEqual([{ name: 'phone-X', serial: 'X1', notionId: 'a' }, { name: 'infra', serial: null, notionId: 'b' }]);
    expect(p.workflows).toEqual([{ name: '朋友圈跟圈', notionId: 'w', channel: 'device' }]);
    expect(query.mock.calls[0][0]).toMatch(/FROM ops_agents/);
    expect(query.mock.calls[1][0]).toMatch(/FROM ops_workflows/);
  });
});

describe('cheapGates', () => {
  it('relation 命中设备工作流 → isDevice + workflowRef，matchedBy=relation:workflow（硬约束）', () => {
    const g = cheapGates(mk({ relations: { agents: [], workflows: ['w1'], skills: [] } }), pool, env);
    expect(g).toMatchObject({ isDevice: true, workflowRef: '朋友圈跟圈', matchedBy: ['relation:workflow'] });
  });
  it('relation 命中手机 agent → isDevice + serial', () => {
    const g = cheapGates(mk({ relations: { agents: ['a1'], workflows: [], skills: [] } }), pool, env);
    expect(g).toMatchObject({ isDevice: true, serial: 'ANGYVB4227006983', matchedBy: ['relation:agent'] });
  });
  it('执行通道非空 → isDevice，workflowRef=通道名', () => {
    const g = cheapGates(mk({ channel: '朋友圈跟圈' }), pool, env);
    expect(g).toMatchObject({ isDevice: true, workflowRef: '朋友圈跟圈', matchedBy: ['channel'] });
  });
  it('正文含 registry 序列号 → isDevice + serial（matchedBy=text:serial）', () => {
    const g = cheapGates(mk({ body: '用 ANGYVB4227006983 这台去发' }), pool, env);
    expect(g).toMatchObject({ isDevice: true, serial: 'ANGYVB4227006983', matchedBy: ['text:serial'] });
  });
  it('正文含设备关键词但无序列号 → isDevice=true, serial=null（留给 Jev 选账号，仍 fail-closed）', () => {
    const g = cheapGates(mk({ body: '给客户朋友圈点赞' }), pool, env);
    expect(g).toMatchObject({ isDevice: true, serial: null, matchedBy: ['text:keyword'] });
  });
  it('纯文字任务 → isDevice=false；写"用 Claude Code"→ hardEngine=claude', () => {
    const g = cheapGates(mk({ body: '用 Claude Code 把首页按钮改蓝' }), pool, env);
    expect(g).toMatchObject({ isDevice: false, serial: null, hardEngine: 'claude', matchedBy: ['text:engine'] });
  });
  it('正文提到部门 agent 名（infra）→ department=infra', () => {
    const g = cheapGates(mk({ body: '让 infra 查一下磁盘' }), pool, env);
    expect(g.department).toBe('infra');
  });
  it('人工态四个词出现在正文不影响判定（只看设备/引擎信号）', () => {
    const g = cheapGates(mk({ body: '收集 下一个行动 阻塞 淘汰' }), pool, env);
    expect(g.isDevice).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → `Cannot find module '../routing/cheap-gates.js'`

- [ ] **Step 3: commit-1** `test(brain): 秋米便宜闸——relation/执行通道/序列号/关键词/引擎正则（先红）`

- [ ] **Step 4: 实现**

```js
// packages/brain/src/routing/cheap-gates.js
/**
 * 便宜闸永远在 Jev 前（铁律 6eb0dff5）；设备判定以注册表/字段命中为主（主理人拍板），Jev 只补判。
 */
export async function loadRegistryPool(query) {
  const a = await query(`SELECT name, meta, notion_id FROM ops_agents WHERE status = 'active' ORDER BY name`);
  const w = await query(`SELECT name, meta, notion_id FROM ops_workflows WHERE active = TRUE ORDER BY name`);
  return {
    agents: (a.rows ?? []).map((r) => ({ name: r.name, serial: r.meta?.serial ?? r.meta?.phone_serial ?? null, notionId: r.notion_id ?? null })),
    workflows: (w.rows ?? []).map((r) => ({ name: r.name, notionId: r.notion_id ?? null, channel: r.meta?.channel ?? null })),
  };
}

const ENGINE_RES = [[/claude\s*code|用\s*claude/i, 'claude'], [/用\s*codex|codex\s*做/i, 'codex']];

export function cheapGates(task, pool, env) {
  const src = task?.payload?.qiumi_source ?? {};
  const text = [src.title, src.remark, src.body].filter(Boolean).join('\n');
  const norm = (s) => String(s ?? '').replace(/-/g, '');
  const out = { isDevice: false, serial: null, workflowRef: null, department: null, hardEngine: null, matchedBy: [] };

  const relWf = (src.relations?.workflows ?? []).map(norm);
  const wfHit = pool.workflows.find((w) => w.notionId && relWf.includes(norm(w.notionId)));
  if (wfHit) { out.workflowRef = wfHit.name; if (wfHit.channel === 'device') out.isDevice = true; out.matchedBy.push('relation:workflow'); }

  const relAg = (src.relations?.agents ?? []).map(norm);
  const agHit = pool.agents.find((a) => a.notionId && relAg.includes(norm(a.notionId)));
  if (agHit) { if (agHit.serial) { out.isDevice = true; out.serial = agHit.serial; } else { out.department = agHit.name; } out.matchedBy.push('relation:agent'); }

  if (src.channel) { out.isDevice = true; out.workflowRef = out.workflowRef ?? src.channel; out.matchedBy.push('channel'); }

  if (!out.serial) {
    const s = pool.agents.find((a) => a.serial && text.includes(a.serial));
    if (s) { out.isDevice = true; out.serial = s.serial; out.matchedBy.push('text:serial'); }
  }
  if (!out.workflowRef) {
    const w = pool.workflows.find((w) => text.includes(w.name));
    if (w) { out.workflowRef = w.name; if (w.channel === 'device') out.isDevice = true; out.matchedBy.push('text:workflow'); }
  }
  if (!out.department) {
    const d = env.departments.find((d) => new RegExp(`\\b${d}\\b`, 'i').test(text));
    if (d) { out.department = d; out.matchedBy.push('text:department'); }
  }
  if (!out.isDevice && env.deviceKeywords.some((k) => text.includes(k))) { out.isDevice = true; out.matchedBy.push('text:keyword'); }
  for (const [re, eng] of ENGINE_RES) if (re.test(text)) { out.hardEngine = eng; out.matchedBy.push('text:engine'); break; }
  return out;
}
```

- [ ] **Step 5: 跑测试转绿** → `9 passed`。变异：删 `text:keyword` 分支 → 关键词用例红；还原绿。

- [ ] **Step 6: commit-2** `feat(brain): 秋米便宜闸——注册表/relation/执行通道/序列号/关键词命中，引擎正则硬约束`

---

### Task 3: `routing/qiumi-router.js` 决策合成 + 留痕 + 持久化

**Files:**
- Create: `packages/brain/src/routing/qiumi-router.js`
- Test: `packages/brain/src/__tests__/qiumi-router.test.js`

**Interfaces:**
- Consumes: Task 1/2；`recordTaskEventSafe(pool, taskId, type, payload)`（`lib/task-event-log.js:18`）；`qiumiEnv`
- Produces: `routeQiumiTask(task, { pool, env, fetchFn, callLLMFn, now }) → Decision`
  - `Decision = { outcome:'device', serial, workflowRef, department, payloadPatch } | { outcome:'agent', engine, model, department, kind, workflowRef, runId, payloadPatch } | { outcome:'fail', reason, detail }`
  - 规则：`cheap.isDevice===true` → 需 `serial`：cheap.serial ?? （Jev/terra `account.choice`∈池 且 confidence≥0.8）→ device；否则 fail `device_serial_unresolved`。cheap.isDevice===false → 问 Jev：`is_device.choice==='true'` 且 confidence≥0.8 → 同上走 device 分支（fail-closed）；`is_device` confidence<0.8 且 choice==='true' → fail `device_uncertain`；否则 agent：engine = cheap.hardEngine ?? answers.engine.choice；department = cheap.department ?? answers.department.choice（不在池 → 'main'）；kind = answers.kind.choice；workflowRef = cheap.workflowRef ?? (answers.workflow_ref?.choice 非 not_applicable ? 该值 : null)；model = env.modelMap[engine]；runId = `qiumi-${task.id.slice(0,8)}-${now()}`。
  - `payloadPatch`（agent）：`{ qiumi_route:{source, answers, cheap:{matchedBy}, decided_at}, model, provider:'openclaw', run_id, qiumi_department, qiumi_kind, qiumi_workflow_ref }`；（device）：`{ qiumi_route:{…}, serial, source:'oneoff', headed_manual:true, qiumi_workflow_ref }`。
  - `persistDecision(pool, task, decision)`：device → `UPDATE tasks SET task_type='device_job', trigger_source='manual', assigned_to=$serialAgent, claimed_by=NULL, claimed_at=NULL, executor_kind='headed-session', payload = payload || $patch, updated_at=NOW() WHERE id=$1 AND status='queued'`（`assigned_to = 'phone-'+serial`，与 zenithjoy 领单器两形态认领兼容）；agent → `UPDATE tasks SET payload = payload || $patch, updated_at=NOW() WHERE id=$1`；fail → `UPDATE tasks SET status='failed', error_message=$reason, claimed_by=NULL, claimed_at=NULL, updated_at=NOW() WHERE id=$1 AND status='queued'`。每种各写一条 `task_events`。

- [ ] **Step 1: 写失败测试**（决策表，≥10 用例）

```js
// packages/brain/src/__tests__/qiumi-router.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../lib/task-event-log.js', () => ({ recordTaskEventSafe: vi.fn().mockResolvedValue(true) }));
vi.mock('../routing/cheap-gates.js', async (orig) => ({ ...(await orig()), loadRegistryPool: vi.fn() }));
import { recordTaskEventSafe } from '../lib/task-event-log.js';
import { loadRegistryPool } from '../routing/cheap-gates.js';
import { routeQiumiTask, persistDecision } from '../routing/qiumi-router.js';
import { qiumiEnv } from '../routing/env.js';

const env = qiumiEnv({ JEV_API_KEY: 'k' });
const registry = { agents: [{ name: 'phone-S1', serial: 'S1', notionId: 'a1' }], workflows: [{ name: '朋友圈跟圈', notionId: 'w1', channel: 'device' }] };
const answers = (o = {}) => ({ kind: { choice: 'agent', confidence: 0.95 }, is_device: { choice: 'false', confidence: 0.95 }, engine: { choice: 'terra', confidence: 0.9 }, department: { choice: 'dev', confidence: 0.9 }, account: { choice: 'not_applicable', confidence: 0.9 }, workflow_ref: { choice: 'not_applicable', confidence: 0.9 }, ...o });
const jevOk = (a) => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ answers: a }) });
const task = (body, extra = {}) => ({ id: '11111111-2222-3333-4444-555555555555', task_type: 'qiumi_task', status: 'queued', payload: { qiumi_source: { title: 'T', remark: '', body, channel: null, relations: { agents: [], workflows: [], skills: [] } }, ...extra } });

beforeEach(() => { vi.clearAllMocks(); loadRegistryPool.mockResolvedValue(registry); });

describe('routeQiumiTask 决策表', () => {
  const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  it('纯文字 + 正文要 Claude → agent/claude，model 查表，run_id 合规，留痕 qiumi_route_decided', async () => {
    const d = await routeQiumiTask(task('用 Claude Code 改按钮'), { pool, env, fetchFn: jevOk(answers()), callLLMFn: vi.fn(), now: () => 1700000000000 });
    expect(d).toMatchObject({ outcome: 'agent', engine: 'claude', model: 'claude-cli/claude-sonnet-5', department: 'dev', kind: 'agent' });
    expect(d.runId).toMatch(/^qiumi-11111111-\d+$/);
    expect(d.payloadPatch.model).toBe('claude-cli/claude-sonnet-5');
    expect(recordTaskEventSafe).toHaveBeenCalledWith(pool, task().id, 'qiumi_route_decided', expect.objectContaining({ outcome: 'agent', source: 'jev' }));
  });
  it('无硬约束 → engine 取 Jev 答案', async () => {
    const d = await routeQiumiTask(task('帮我写个周报'), { pool, env, fetchFn: jevOk(answers({ engine: { choice: 'codex', confidence: 0.8 } })), callLLMFn: vi.fn() });
    expect(d).toMatchObject({ outcome: 'agent', engine: 'codex', model: 'openai/gpt-5.3-codex' });
  });
  it('便宜闸命中序列号 → device，不调 Jev，payloadPatch 含 serial/source=oneoff/headed_manual', async () => {
    const fetchFn = vi.fn();
    const d = await routeQiumiTask(task('用 S1 去点赞'), { pool, env, fetchFn, callLLMFn: vi.fn() });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(d).toMatchObject({ outcome: 'device', serial: 'S1', payloadPatch: { serial: 'S1', source: 'oneoff', headed_manual: true } });
  });
  it('便宜闸只命中关键词无序列号 → 问 Jev 选账号；账号∈池且≥0.8 → device', async () => {
    const d = await routeQiumiTask(task('去朋友圈点赞'), { pool, env, fetchFn: jevOk(answers({ is_device: { choice: 'true', confidence: 0.99 }, account: { choice: 'S1', confidence: 0.9 } })), callLLMFn: vi.fn() });
    expect(d).toMatchObject({ outcome: 'device', serial: 'S1' });
  });
  it('关键词命中但 Jev 选了池外账号 → fail device_serial_unresolved（fail-closed）', async () => {
    const d = await routeQiumiTask(task('去朋友圈点赞'), { pool, env, fetchFn: jevOk(answers({ is_device: { choice: 'true', confidence: 0.99 }, account: { choice: 'NOT_IN_POOL', confidence: 0.99 } })), callLLMFn: vi.fn() });
    expect(d).toMatchObject({ outcome: 'fail', reason: 'device_serial_unresolved' });
    expect(recordTaskEventSafe).toHaveBeenCalledWith(pool, task().id, 'qiumi_route_failed', expect.objectContaining({ reason: 'device_serial_unresolved' }));
  });
  it('便宜闸未命中但 Jev 判 is_device=true 且 ≥0.8 且账号在池 → device', async () => {
    const d = await routeQiumiTask(task('把这条发出去'), { pool, env, fetchFn: jevOk(answers({ is_device: { choice: 'true', confidence: 0.85 }, account: { choice: 'S1', confidence: 0.9 } })), callLLMFn: vi.fn() });
    expect(d.outcome).toBe('device');
  });
  it('Jev 判 is_device=true 但置信 0.6 → fail device_uncertain（绝不掉进 agent 通道）', async () => {
    const d = await routeQiumiTask(task('把这条发出去'), { pool, env, fetchFn: jevOk(answers({ is_device: { choice: 'true', confidence: 0.6 } })), callLLMFn: vi.fn() });
    expect(d).toMatchObject({ outcome: 'fail', reason: 'device_uncertain' });
  });
  it('Jev 与 terra 全挂 → fail qiumi_router_unavailable', async () => {
    const d = await routeQiumiTask(task('随便'), { pool, env, fetchFn: vi.fn().mockRejectedValue(new Error('x')), callLLMFn: vi.fn().mockRejectedValue(new Error('y')) });
    expect(d).toMatchObject({ outcome: 'fail', reason: 'qiumi_router_unavailable' });
  });
  it('department 不在池 → 回落 main', async () => {
    const d = await routeQiumiTask(task('随便'), { pool, env, fetchFn: jevOk(answers({ department: { choice: 'ghost', confidence: 0.9 } })), callLLMFn: vi.fn() });
    expect(d.department).toBe('main');
  });
  it('kind=workflow 且 workflow_ref 在池 → agent 分支带 workflowRef', async () => {
    const d = await routeQiumiTask(task('跑一遍周报生成'), { pool, env, fetchFn: jevOk(answers({ kind: { choice: 'workflow', confidence: 0.9 }, workflow_ref: { choice: '朋友圈跟圈', confidence: 0.9 }, is_device: { choice: 'false', confidence: 0.9 } })), callLLMFn: vi.fn() });
    expect(d).toMatchObject({ kind: 'workflow', workflowRef: '朋友圈跟圈' });
  });
});

describe('persistDecision', () => {
  it('device → task_type=device_job、assigned_to=phone-<serial>、释放 claim、留痕', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await persistDecision({ query }, task('x'), { outcome: 'device', serial: 'S1', workflowRef: '朋友圈跟圈', department: null, payloadPatch: { serial: 'S1', source: 'oneoff', headed_manual: true, qiumi_route: {} } });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET task_type = 'device_job'/);
    expect(sql).toMatch(/trigger_source = 'manual'/);
    expect(sql).toMatch(/claimed_by = NULL/);
    expect(sql).toMatch(/AND status = 'queued'/);
    expect(params[1]).toBe('phone-S1');
    expect(JSON.parse(params[2])).toMatchObject({ serial: 'S1', source: 'oneoff', headed_manual: true });
    expect(recordTaskEventSafe).toHaveBeenCalledWith({ query }, task().id, 'qiumi_device_converted', expect.objectContaining({ serial: 'S1' }));
  });
  it('agent → 只 merge payload（model/provider/run_id）', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await persistDecision({ query }, task('x'), { outcome: 'agent', engine: 'claude', model: 'claude-cli/claude-sonnet-5', department: 'dev', kind: 'agent', workflowRef: null, runId: 'qiumi-1-2', payloadPatch: { model: 'claude-cli/claude-sonnet-5', provider: 'openclaw', run_id: 'qiumi-1-2', qiumi_department: 'dev', qiumi_kind: 'agent', qiumi_route: {} } });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET payload = COALESCE\(payload, '\{\}'::jsonb\) \|\| \$2::jsonb/);
    expect(JSON.parse(params[1])).toMatchObject({ model: 'claude-cli/claude-sonnet-5', run_id: 'qiumi-1-2' });
  });
  it('fail → status=failed + error_message + 释放 claim（只在 queued 时）', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await persistDecision({ query }, task('x'), { outcome: 'fail', reason: 'device_uncertain', detail: 'conf=0.6' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET status = 'failed'/);
    expect(sql).toMatch(/AND status = 'queued'/);
    expect(params[1]).toBe('device_uncertain: conf=0.6');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → `Cannot find module '../routing/qiumi-router.js'`
- [ ] **Step 3: commit-1** `test(brain): 秋米路由决策表——设备 fail-closed/引擎硬约束/账号池校验/持久化三分支（先红）`
- [ ] **Step 4: 实现**

```js
// packages/brain/src/routing/qiumi-router.js
import { recordTaskEventSafe } from '../lib/task-event-log.js';
import { qiumiEnv } from './env.js';
import { loadRegistryPool, cheapGates } from './cheap-gates.js';
import { buildJevQuestions, decideWithFallback } from './jev-client.js';

export const DEVICE_CONFIDENCE_MIN = 0.8;

function stateOf(task) {
  const s = task?.payload?.qiumi_source ?? {};
  return [`标题：${s.title ?? ''}`, `备注：${s.remark ?? ''}`, `执行通道：${s.channel ?? ''}`, `正文：\n${s.body ?? ''}`].join('\n');
}

function pickSerial(cheap, answers, registry) {
  if (cheap.serial) return cheap.serial;
  const acct = answers?.account;
  if (!acct || acct.choice === 'not_applicable' || acct.confidence < DEVICE_CONFIDENCE_MIN) return null;
  return registry.agents.find((a) => a.serial === acct.choice || a.name === acct.choice)?.serial ?? null;
}

export async function routeQiumiTask(task, deps) {
  const { pool, env = qiumiEnv(), fetchFn, callLLMFn, now = Date.now } = deps;
  const registry = await loadRegistryPool((sql, p) => pool.query(sql, p));
  const cheap = cheapGates(task, registry, env);
  const decidedAt = new Date(now()).toISOString();
  const base = { cheap: { matchedBy: cheap.matchedBy, isDevice: cheap.isDevice, serial: cheap.serial }, decided_at: decidedAt };

  const fail = async (reason, detail, extra = {}) => {
    await recordTaskEventSafe(pool, task.id, 'qiumi_route_failed', { reason, detail, ...base, ...extra });
    return { outcome: 'fail', reason, detail };
  };
  const device = async (serial, source, answers) => {
    const patch = { qiumi_route: { source, answers, ...base }, serial, source: 'oneoff', headed_manual: true, qiumi_workflow_ref: cheap.workflowRef ?? null };
    await recordTaskEventSafe(pool, task.id, 'qiumi_route_decided', { outcome: 'device', source, serial, ...base });
    return { outcome: 'device', serial, workflowRef: cheap.workflowRef ?? null, department: cheap.department ?? null, payloadPatch: patch };
  };

  // 便宜闸已能定序列号 → 不问 Jev
  if (cheap.isDevice && cheap.serial) return device(cheap.serial, 'cheap', null);

  const questions = buildJevQuestions({ departments: env.departments, accountPool: registry.agents.filter((a) => a.serial).map((a) => a.serial), workflowPool: registry.workflows.map((w) => w.name) });
  const r = await decideWithFallback({ state: stateOf(task), questions, env, fetchFn, callLLMFn, now });
  if (r.source === 'fail') return fail(r.reason, 'jev 与 terra 均不可用');
  const a = r.answers;

  const jevSaysDevice = a.is_device?.choice === 'true';
  if (cheap.isDevice || jevSaysDevice) {
    if (!cheap.isDevice && a.is_device.confidence < DEVICE_CONFIDENCE_MIN) return fail('device_uncertain', `conf=${a.is_device.confidence}`, { source: r.source });
    const serial = pickSerial(cheap, a, registry);
    if (!serial) return fail('device_serial_unresolved', `account=${a.account?.choice ?? 'none'}`, { source: r.source });
    return device(serial, r.source, a);
  }

  const engine = cheap.hardEngine ?? (['claude', 'codex', 'terra'].includes(a.engine.choice) ? a.engine.choice : 'terra');
  const department = cheap.department ?? (env.departments.includes(a.department.choice) ? a.department.choice : 'main');
  const kind = a.kind.choice === 'workflow' ? 'workflow' : 'agent';
  const wf = a.workflow_ref?.choice && a.workflow_ref.choice !== 'not_applicable' && registry.workflows.some((w) => w.name === a.workflow_ref.choice) ? a.workflow_ref.choice : null;
  const workflowRef = cheap.workflowRef ?? wf;
  const model = env.modelMap[engine];
  const runId = `qiumi-${String(task.id).slice(0, 8)}-${now()}`;
  const payloadPatch = { qiumi_route: { source: r.source, answers: a, ...base }, model, provider: 'openclaw', run_id: runId, qiumi_department: department, qiumi_kind: kind, qiumi_workflow_ref: workflowRef };
  await recordTaskEventSafe(pool, task.id, 'qiumi_route_decided', { outcome: 'agent', source: r.source, engine, model, department, kind, workflowRef, runId, ...base });
  return { outcome: 'agent', engine, model, department, kind, workflowRef, runId, payloadPatch };
}

export async function persistDecision(pool, task, decision) {
  if (decision.outcome === 'device') {
    await pool.query(
      `UPDATE tasks
          SET task_type = 'device_job', trigger_source = 'manual', assigned_to = $2,
              executor_kind = 'headed-session', claimed_by = NULL, claimed_at = NULL,
              payload = COALESCE(payload, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
        WHERE id = $1 AND status = 'queued'`,
      [task.id, `phone-${decision.serial}`, JSON.stringify(decision.payloadPatch)],
    );
    await recordTaskEventSafe(pool, task.id, 'qiumi_device_converted', { serial: decision.serial, workflowRef: decision.workflowRef });
    return;
  }
  if (decision.outcome === 'agent') {
    await pool.query(
      `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [task.id, JSON.stringify(decision.payloadPatch)],
    );
    return;
  }
  await pool.query(
    `UPDATE tasks SET status = 'failed', error_message = $2, claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'queued'`,
    [task.id, `${decision.reason}: ${decision.detail ?? ''}`.trim()],
  );
}
```

- [ ] **Step 5: 跑测试转绿** → `13 passed`。变异：把 `DEVICE_CONFIDENCE_MIN` 改 0.5 → 「置信 0.6 → fail」用例红；删 `pickSerial` 的池内校验 → 「池外账号 → fail」红；还原绿，写进 commit body。
- [ ] **Step 6: commit-2** `feat(brain): 秋米路由决策合成——便宜闸优先、设备 fail-closed(<0.8 不派)、账号仅池内、三分支持久化+task_events 留痕`

---

### Task 4: dispatcher 接线（路由插入点 + 并发闸 + 设备转换短路）

**Files:**
- Modify: `packages/brain/src/dispatcher.js`（`let taskToDispatch = fullTaskResult.rows[0];` 之后、`applyDispatchAllocationGuide` 之前）
- Modify: `packages/brain/src/notion-gtd-sync.js`（PR2 产物：`ingestQiumiPage` 的 `headed_manual: env.QIUMI_DISPATCH_ENABLED !== 'true'`）
- Test: `packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js`（照 `device-job-foundation.test.js` 的真调用 + mock 依赖链写法）

**Interfaces:**
- Consumes: `routeQiumiTask`/`persistDecision`；`recordDispatchResult`；`qiumiEnv`
- Produces：dispatcher 对 `qiumi_task` 的三条出口：`{dispatched:false, reason:'qiumi_routed_device'}`（已转 device_job，claim 已释放）、`{dispatched:false, reason:'qiumi_route_failed'}`（已 failed）、`{dispatched:false, reason:'openclaw_agent_pool_full'}`（释放 claim、任务留 queued）；agent 分支继续走 `enforceDispatchRoutingReceipt` + `triggerCeceliaRun`（payload 已带 model/run_id）。

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => mockQuery(...a) } }));
vi.mock('../routing/qiumi-router.js', () => ({ routeQiumiTask: vi.fn(), persistDecision: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../executor.js', async (orig) => ({ ...(await orig()), triggerCeceliaRun: vi.fn().mockResolvedValue({ success: true, taskId: 't', runId: 'r' }) }));
vi.mock('../dispatch-stats.js', () => ({ recordDispatchResult: vi.fn().mockResolvedValue(undefined) }));
import { routeQiumiTask } from '../routing/qiumi-router.js';
import { triggerCeceliaRun } from '../executor.js';
import { recordDispatchResult } from '../dispatch-stats.js';
import { dispatchQiumiTask } from '../dispatcher.js';

const task = { id: 'q1', task_type: 'qiumi_task', status: 'queued', priority: 'P2', payload: { qiumi_source: {} } };
beforeEach(() => { vi.clearAllMocks(); });

describe('dispatchQiumiTask（dispatcher 对 qiumi_task 的专用出口）', () => {
  it('并发闸：in_progress openclaw-agent ≥ 上限 → 释放 claim，reason=openclaw_agent_pool_full，不路由', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 2 }] }).mockResolvedValue({ rows: [] });
    const r = await dispatchQiumiTask(task, { env: { mmvConcurrency: 2 } });
    expect(r).toMatchObject({ dispatched: false, reason: 'openclaw_agent_pool_full' });
    expect(routeQiumiTask).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /claimed_by = NULL/.test(sql))).toBe(true);
    expect(recordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'openclaw_agent_pool_full', undefined, 'q1');
  });
  it('device 决策 → persistDecision + reason=qiumi_routed_device，不 spawn', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] });
    routeQiumiTask.mockResolvedValue({ outcome: 'device', serial: 'S1', payloadPatch: {} });
    const r = await dispatchQiumiTask(task, { env: { mmvConcurrency: 2 } });
    expect(r).toMatchObject({ dispatched: false, reason: 'qiumi_routed_device' });
    expect(triggerCeceliaRun).not.toHaveBeenCalled();
  });
  it('fail 决策 → reason=qiumi_route_failed，不 spawn，不计熔断（recordDispatchResult 记 qiumi_route_failed）', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] });
    routeQiumiTask.mockResolvedValue({ outcome: 'fail', reason: 'device_uncertain', detail: 'conf=0.6' });
    const r = await dispatchQiumiTask(task, { env: { mmvConcurrency: 2 } });
    expect(r).toMatchObject({ dispatched: false, reason: 'qiumi_route_failed' });
    expect(triggerCeceliaRun).not.toHaveBeenCalled();
  });
  it('agent 决策 → 持久化后 spawn，传给 triggerCeceliaRun 的 task 带 model/run_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] }).mockResolvedValue({ rows: [{ ...task, payload: { ...task.payload, model: 'claude-cli/claude-sonnet-5', run_id: 'qiumi-q1-1' } }] });
    routeQiumiTask.mockResolvedValue({ outcome: 'agent', engine: 'claude', model: 'claude-cli/claude-sonnet-5', runId: 'qiumi-q1-1', payloadPatch: { model: 'claude-cli/claude-sonnet-5', run_id: 'qiumi-q1-1' } });
    const r = await dispatchQiumiTask(task, { env: { mmvConcurrency: 2 } });
    expect(r).toMatchObject({ dispatched: true, reason: 'qiumi_agent' });
    expect(triggerCeceliaRun.mock.calls[0][0].payload).toMatchObject({ model: 'claude-cli/claude-sonnet-5', run_id: 'qiumi-q1-1' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → `dispatchQiumiTask is not a function`
- [ ] **Step 3: commit-1** `test(brain): dispatcher 对 qiumi_task 的并发闸/设备短路/失败短路/agent 派发（先红）`
- [ ] **Step 4: 实现**（`dispatcher.js`）

在 import 区追加：
```js
import { routeQiumiTask, persistDecision } from './routing/qiumi-router.js';
import { qiumiEnv } from './routing/env.js';
```
新增导出函数（放在 `dispatchNextTask` 之前）：
```js
/**
 * qiumi_task 专用派发出口（PR3）。claim 已由调用方持有。
 * 顺序：机器并发闸 → 路由判定（便宜闸→Jev→terra→fail）→ 持久化 → 仅 agent 分支 spawn。
 */
export async function dispatchQiumiTask(task, deps = {}) {
  const env = deps.env ?? qiumiEnv();
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM tasks WHERE executor_kind = 'openclaw-agent' AND status = 'in_progress'`,
  );
  if ((rows[0]?.n ?? 0) >= env.mmvConcurrency) {
    await pool.query(`UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`, [task.id]);
    await recordDispatchResult(pool, false, 'openclaw_agent_pool_full', undefined, task.id);
    return { dispatched: false, reason: 'openclaw_agent_pool_full', task_id: task.id, actions: [] };
  }
  const decision = await routeQiumiTask(task, { pool, env, fetchFn: deps.fetchFn, callLLMFn: deps.callLLMFn ?? (await import('./llm-caller.js')).callLLM });
  await persistDecision(pool, task, decision);
  if (decision.outcome === 'device') {
    await recordDispatchResult(pool, false, 'qiumi_routed_device', undefined, task.id);
    return { dispatched: false, reason: 'qiumi_routed_device', task_id: task.id, actions: [{ action: 'qiumi-device-converted', task_id: task.id, serial: decision.serial }] };
  }
  if (decision.outcome === 'fail') {
    await recordDispatchResult(pool, false, 'qiumi_route_failed', undefined, task.id);
    return { dispatched: false, reason: 'qiumi_route_failed', task_id: task.id, actions: [{ action: 'qiumi-route-failed', task_id: task.id, error: decision.reason }] };
  }
  const fresh = await pool.query('SELECT * FROM tasks WHERE id = $1', [task.id]);
  const execResult = await triggerCeceliaRun(fresh.rows[0] ?? task);
  if (!execResult?.success) {
    await pool.query(`UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`, [task.id]);
    await recordDispatchResult(pool, false, execResult?.reason || 'openclaw_agent_spawn_failed', undefined, task.id);
    return { dispatched: false, reason: execResult?.reason || 'openclaw_agent_spawn_failed', task_id: task.id, actions: [] };
  }
  await recordDispatchResult(pool, true, 'qiumi_agent', undefined, task.id);
  return { dispatched: true, reason: 'qiumi_agent', task_id: task.id, run_id: decision.runId, actions: [{ action: 'qiumi-agent-spawned', task_id: task.id }] };
}
```
在 `let taskToDispatch = fullTaskResult.rows[0];` 之后插入：
```js
  if (taskToDispatch.task_type === 'qiumi_task') {
    return dispatchQiumiTask(taskToDispatch);
  }
```
`notion-gtd-sync.js`（PR2 `ingestQiumiPage`）：`headed_manual: true` → `headed_manual: (env.QIUMI_DISPATCH_ENABLED !== 'true')`，并在其测试加一条"QIUMI_DISPATCH_ENABLED=true 时不写 headed_manual"。

- [ ] **Step 5: 跑测试转绿**：`npx vitest run src/__tests__/dispatcher-qiumi-routing.test.js src/__tests__/device-job-foundation.test.js src/__tests__/dispatch-preflight-skip.test.js src/__tests__/notion-gtd-sync*.test.js` → 全绿。变异：删并发闸 `>=` 判断 → 闸用例红；还原绿。
- [ ] **Step 6: commit-2** `feat(brain): dispatcher 接秋米路由——并发闸 2、设备转 device_job 短路、判定失败短路、agent 分支带 model/run_id 派发`

---

### Task 5: `openclaw-agent-executor.js`（ssh nohup 起 agent + 收割）+ `executor.js` 0.7 分支 + reaper job

**Files:**
- Create: `packages/brain/src/openclaw-agent-executor.js`
- Modify: `packages/brain/src/executor.js`（`triggerCeceliaRun` internal handler 块之后加 0.7 分支）
- Modify: `packages/brain/src/scheduler-jobs.js`（JOBS 追加 `openclaw-agent-reaper`）
- Test: `packages/brain/src/__tests__/openclaw-agent-executor.test.js`、`packages/brain/src/__tests__/scheduler-jobs-openclaw-reaper.test.js`

**Interfaces:**
- Consumes: `SSH_BASE_ARGS`（`./lib/ssh-args.js`；rebase 前若缺失则临时从 `./notion-push-sync.js` import 并在 rebase 后改回）、`sshTargetFor('us-mac-m4')`、`execFile`（注入 `execFileFn`）、`recordTaskEventSafe`、`qiumiEnv`
- Produces:
  - `buildRemoteCommand({ runId, department, model, taskId, timeoutSec=1800 }) → string`（远端 sh：`mkdir -p ~/brain-runs && M=$(cat) && nohup sh -c '/opt/homebrew/bin/openclaw agent --agent <dept> --model <model> --session-key agent:<dept>:qiumi-<taskId> --message "$M" --timeout <sec> --json > ~/brain-runs/<runId>.log 2>&1; echo $? > ~/brain-runs/<runId>.exit' >/dev/null 2>&1 & echo $! > ~/brain-runs/<runId>.pid; echo DISPATCHED`）
  - `triggerOpenclawAgent(task, deps) → { success:true, taskId, runId, executor:'openclaw-agent' } | { success:false, reason:'openclaw_agent_spawn_failed', error }`：校验 `payload.run_id`/`model`/`qiumi_department`（缺 → success:false 不 spawn）；prompt = `qiumi_source` 标题+备注+正文（不打码——发给自家执行体）；`execFileFn('ssh', [...SSH_BASE_ARGS, target, remote], { input: prompt, timeout: 30000 })`；输出含 `DISPATCHED` 才算成功；`setExecutorKind(task.id,'openclaw-agent')` + `UPDATE tasks SET status='in_progress', started_at=COALESCE(started_at,NOW()) WHERE id=$1` + 留痕 `openclaw_agent_spawned`
  - `reapOpenclawAgentRuns(pool, deps) → { reaped, completed, failed }`：查 `task_type='qiumi_task' AND status='in_progress' AND executor_kind='openclaw-agent' AND payload->>'run_id' IS NOT NULL LIMIT 20`；远端 `if [ -f ~/brain-runs/<run_id>.exit ]; then echo EXIT=$(cat …exit); tail -c 4000 …log; else echo NO_EXIT; fi`；`EXIT=0` → 解析 log 末段 JSON 的 `finalAssistantVisibleText`/`result.payloads[0].text`，`UPDATE tasks SET status='completed_no_pr', completed_at=COALESCE(completed_at,NOW()), claimed_by=NULL, claimed_at=NULL, result = COALESCE(result,'{}'::jsonb) || jsonb_build_object('receipt', $2::jsonb), updated_at=NOW() WHERE id=$1 AND status='in_progress'`（receipt 固定子键，55f0d846）；`EXIT≠0` → `status='failed', error_message='openclaw_agent_exit_<n>'`；`NO_EXIT` → 不动（stale 由合同 45min + 守护刀 onStale fail 处理）。留痕 `openclaw_agent_reaped`。
  - `scheduler-jobs`：`{ name:'openclaw-agent-reaper', needsPool:true, timeoutMs: DEFAULT_TIMEOUT_MS, handler:(pool)=>reapOpenclawAgentRuns(pool), description:'秋米 openclaw-agent 收割（60s，读 MMV ~/brain-runs/<run_id>.exit → completed_no_pr/failed，PR3）' }`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/openclaw-agent-executor.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../lib/task-event-log.js', () => ({ recordTaskEventSafe: vi.fn().mockResolvedValue(true) }));
vi.mock('../machine-registry.js', () => ({ sshTargetFor: vi.fn(() => 'administrator@100.71.151.105') }));
import { recordTaskEventSafe } from '../lib/task-event-log.js';
import { buildRemoteCommand, triggerOpenclawAgent, reapOpenclawAgentRuns } from '../openclaw-agent-executor.js';

const task = { id: 'aaaaaaaa-1111-2222-3333-444444444444', task_type: 'qiumi_task', status: 'queued', payload: { run_id: 'qiumi-aaaaaaaa-1', model: 'claude-cli/claude-sonnet-5', qiumi_department: 'dev', qiumi_source: { title: '标题', remark: '备', body: 'token: SECRET 正文' } } };
beforeEach(() => vi.clearAllMocks());

describe('buildRemoteCommand', () => {
  it('nohup + .log/.exit/.pid 三件套，prompt 走 $M=$(cat)，不出现在命令行', () => {
    const c = buildRemoteCommand({ runId: 'r1', department: 'dev', model: 'claude-cli/claude-sonnet-5', taskId: 't1' });
    expect(c).toContain('M=$(cat)');
    expect(c).toContain('/opt/homebrew/bin/openclaw agent --agent dev --model claude-cli/claude-sonnet-5 --session-key agent:dev:qiumi-t1 --message "$M" --timeout 1800 --json');
    expect(c).toContain('> ~/brain-runs/r1.log 2>&1; echo $? > ~/brain-runs/r1.exit');
    expect(c).toContain('echo $! > ~/brain-runs/r1.pid');
    expect(c).toContain('echo DISPATCHED');
    expect(c).not.toContain('正文');
  });
  it('run_id/department/model 非法字符 → 抛错（注入面）', () => {
    expect(() => buildRemoteCommand({ runId: 'r;rm -rf', department: 'dev', model: 'm', taskId: 't' })).toThrow(/invalid/);
    expect(() => buildRemoteCommand({ runId: 'r', department: 'dev x', model: 'm', taskId: 't' })).toThrow(/invalid/);
  });
});

describe('triggerOpenclawAgent', () => {
  it('成功：ssh 参数数组含 SSH_BASE_ARGS+target+remote，input=prompt(不打码)，DISPATCHED → in_progress + executor_kind + 留痕', async () => {
    const execFileFn = vi.fn((cmd, args, opts, cb) => cb(null, 'DISPATCHED\n', ''));
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const r = await triggerOpenclawAgent(task, { execFileFn, pool: { query } });
    expect(r).toMatchObject({ success: true, runId: 'qiumi-aaaaaaaa-1', executor: 'openclaw-agent' });
    const [cmd, args, opts] = execFileFn.mock.calls[0];
    expect(cmd).toBe('ssh');
    expect(args).toContain('administrator@100.71.151.105');
    expect(args).toContain('BatchMode=yes');
    expect(opts.input).toContain('SECRET');
    expect(query.mock.calls.some(([sql]) => /executor_kind = 'openclaw-agent'/.test(sql))).toBe(true);
    expect(query.mock.calls.some(([sql]) => /SET status = 'in_progress'/.test(sql))).toBe(true);
    expect(recordTaskEventSafe).toHaveBeenCalledWith(expect.anything(), task.id, 'openclaw_agent_spawned', expect.objectContaining({ run_id: 'qiumi-aaaaaaaa-1' }));
  });
  it('缺 run_id/model → success:false 不 ssh', async () => {
    const execFileFn = vi.fn();
    const r = await triggerOpenclawAgent({ ...task, payload: { qiumi_source: {} } }, { execFileFn, pool: { query: vi.fn() } });
    expect(r).toMatchObject({ success: false, reason: 'openclaw_agent_spawn_failed' });
    expect(execFileFn).not.toHaveBeenCalled();
  });
  it('ssh 输出无 DISPATCHED / 抛错 → success:false', async () => {
    const execFileFn = vi.fn((c, a, o, cb) => cb(new Error('ssh: connect refused'), '', ''));
    const r = await triggerOpenclawAgent(task, { execFileFn, pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } });
    expect(r.success).toBe(false);
  });
});

describe('reapOpenclawAgentRuns', () => {
  const row = { id: task.id, run_id: 'qiumi-aaaaaaaa-1' };
  it('EXIT=0 → completed_no_pr + receipt 子键（finalAssistantVisibleText）', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'EXIT=0\n{"finalAssistantVisibleText":"done ✓"}\n', ''));
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(r).toEqual({ reaped: 1, completed: 1, failed: 0 });
    const upd = query.mock.calls.find(([sql]) => /completed_no_pr/.test(sql));
    expect(upd[0]).toMatch(/jsonb_build_object\('receipt', \$2::jsonb\)/);
    expect(upd[0]).toMatch(/AND status = 'in_progress'/);
    expect(JSON.parse(upd[1][1])).toMatchObject({ exit: 0, text: 'done ✓' });
  });
  it('EXIT=1 → failed + error_message=openclaw_agent_exit_1', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'EXIT=1\nboom\n', ''));
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(r.failed).toBe(1);
    expect(query.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql))[1][1]).toBe('openclaw_agent_exit_1');
  });
  it('NO_EXIT → 不动（交给合同 stale 45min）', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'NO_EXIT\n', ''));
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(r).toEqual({ reaped: 0, completed: 0, failed: 0 });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
```

```js
// packages/brain/src/__tests__/scheduler-jobs-openclaw-reaper.test.js
import { describe, it, expect } from 'vitest';
import { JOBS } from '../scheduler-jobs.js';
describe('scheduler-jobs 登记 openclaw-agent-reaper', () => {
  it('存在、needsPool、handler 是函数', () => {
    const j = JOBS.find((x) => x.name === 'openclaw-agent-reaper');
    expect(j).toBeTruthy();
    expect(j.needsPool).toBe(true);
    expect(typeof j.handler).toBe('function');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → `Cannot find module '../openclaw-agent-executor.js'`；reaper job 不存在。
- [ ] **Step 3: commit-1** `test(brain): openclaw-agent 执行体——远端命令三件套/stdin prompt/收割三态 + reaper job 登记（先红）`
- [ ] **Step 4: 实现 `openclaw-agent-executor.js`**

```js
// packages/brain/src/openclaw-agent-executor.js
/**
 * 秋米非设备任务执行体（PR3）：Brain（us-vps）经 ssh 在 MMV(us-mac-m4) 起 `openclaw agent`。
 * us-vps 只调度不执行（96054a8b/eb0a03df）。prompt 走 stdin（不拼命令行）；.log/.exit/.pid 三件套
 * 由 PR1 合同 openclaw-agent 的 probe 与本文件 reaper 共用。
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { SSH_BASE_ARGS } from './lib/ssh-args.js';
import { sshTargetFor } from './machine-registry.js';
import { recordTaskEventSafe } from './lib/task-event-log.js';

const SAFE = /^[A-Za-z0-9._\/:-]+$/;
const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
export const AGENT_TIMEOUT_SEC = 1800;

export function buildRemoteCommand({ runId, department, model, taskId, timeoutSec = AGENT_TIMEOUT_SEC }) {
  for (const [k, v] of Object.entries({ runId, department, model, taskId })) if (!SAFE.test(String(v))) throw new Error(`invalid ${k}`);
  const log = `~/brain-runs/${runId}.log`, exit = `~/brain-runs/${runId}.exit`, pid = `~/brain-runs/${runId}.pid`;
  const inner = `${OPENCLAW_BIN} agent --agent ${department} --model ${model} --session-key agent:${department}:qiumi-${taskId} --message "$M" --timeout ${timeoutSec} --json > ${log} 2>&1; echo $? > ${exit}`;
  return `mkdir -p ~/brain-runs && M=$(cat) && export M && nohup sh -c '${inner}' >/dev/null 2>&1 & echo $! > ${pid}; echo DISPATCHED`;
}

function sshRun(execFileFn, args, opts) {
  return new Promise((resolve, reject) => execFileFn('ssh', args, opts, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(String(stdout)))));
}

function promptOf(task) {
  const s = task.payload?.qiumi_source ?? {};
  return [s.title, s.remark ? `补充说明：${s.remark}` : null, s.body ? `页面正文：\n${s.body}` : null].filter(Boolean).join('\n\n');
}

export async function triggerOpenclawAgent(task, deps = {}) {
  const execFileFn = deps.execFileFn ?? nodeExecFile;
  const pool = deps.pool ?? (await import('./db.js')).default;
  const runId = task.payload?.run_id, model = task.payload?.model, department = task.payload?.qiumi_department;
  if (!runId || !model || !department) return { success: false, taskId: task.id, reason: 'openclaw_agent_spawn_failed', error: 'missing run_id/model/department' };
  let remote, target;
  try { remote = buildRemoteCommand({ runId, department, model, taskId: task.id }); target = sshTargetFor('us-mac-m4'); }
  catch (err) { return { success: false, taskId: task.id, reason: 'openclaw_agent_spawn_failed', error: err.message }; }
  try {
    const out = await sshRun(execFileFn, [...SSH_BASE_ARGS, target, remote], { input: promptOf(task), timeout: 30_000, encoding: 'utf8' });
    if (!/DISPATCHED/.test(out)) throw new Error(`no DISPATCHED marker: ${out.slice(0, 120)}`);
  } catch (err) {
    return { success: false, taskId: task.id, reason: 'openclaw_agent_spawn_failed', error: err.message };
  }
  await pool.query(`UPDATE tasks SET executor_kind = 'openclaw-agent', updated_at = NOW() WHERE id = $1`, [task.id]);
  await pool.query(`UPDATE tasks SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = $1 AND status = 'queued'`, [task.id]);
  await recordTaskEventSafe(pool, task.id, 'openclaw_agent_spawned', { run_id: runId, department, model, machine: 'us-mac-m4' });
  return { success: true, taskId: task.id, runId, executor: 'openclaw-agent' };
}

function parseReceipt(exit, tail) {
  let text = null;
  const m = tail.match(/\{[\s\S]*\}\s*$/);
  if (m) { try { const j = JSON.parse(m[0]); text = j.finalAssistantVisibleText ?? j?.result?.payloads?.[0]?.text ?? null; } catch { /* 非 JSON 尾巴 */ } }
  return { exit, text, log_tail: tail.slice(-2000), reaped_at: new Date().toISOString() };
}

export async function reapOpenclawAgentRuns(pool, deps = {}) {
  const execFileFn = deps.execFileFn ?? nodeExecFile;
  const { rows } = await pool.query(
    `SELECT id, payload->>'run_id' AS run_id FROM tasks
      WHERE task_type = 'qiumi_task' AND status = 'in_progress' AND executor_kind = 'openclaw-agent'
        AND payload->>'run_id' IS NOT NULL LIMIT 20`,
  );
  const out = { reaped: 0, completed: 0, failed: 0 };
  for (const r of rows ?? []) {
    if (!SAFE.test(r.run_id)) continue;
    let stdout;
    try {
      stdout = await sshRun(execFileFn, [...SSH_BASE_ARGS, sshTargetFor('us-mac-m4'), `if [ -f ~/brain-runs/${r.run_id}.exit ]; then echo EXIT=$(cat ~/brain-runs/${r.run_id}.exit); tail -c 4000 ~/brain-runs/${r.run_id}.log 2>/dev/null; else echo NO_EXIT; fi`], { timeout: 20_000, encoding: 'utf8' });
    } catch (err) { console.warn(`[openclaw-agent] 收割 ${r.run_id} 探测失败: ${err.message}`); continue; }
    const m = stdout.match(/^EXIT=(\d+)/m);
    if (!m) continue;
    const exit = parseInt(m[1], 10);
    const tail = stdout.replace(/^EXIT=\d+\n?/m, '');
    const receipt = parseReceipt(exit, tail);
    if (exit === 0) {
      await pool.query(
        `UPDATE tasks SET status = 'completed_no_pr', completed_at = COALESCE(completed_at, NOW()), claimed_by = NULL, claimed_at = NULL,
                result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('receipt', $2::jsonb), updated_at = NOW()
          WHERE id = $1 AND status = 'in_progress'`,
        [r.id, JSON.stringify(receipt)],
      );
      out.completed++;
    } else {
      await pool.query(
        `UPDATE tasks SET status = 'failed', error_message = $2, claimed_by = NULL, claimed_at = NULL,
                result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('receipt', $3::jsonb), updated_at = NOW()
          WHERE id = $1 AND status = 'in_progress'`,
        [r.id, `openclaw_agent_exit_${exit}`, JSON.stringify(receipt)],
      );
      out.failed++;
    }
    out.reaped++;
    await recordTaskEventSafe(pool, r.id, 'openclaw_agent_reaped', { run_id: r.run_id, exit });
  }
  return out;
}
```

`executor.js` `triggerCeceliaRun` 在 internal handler 块（0.6）之后追加：
```js
  // 0.7 秋米非设备任务（PR3）→ openclaw-agent 执行体（ssh 到 MMV，us-vps 只调度）
  if (task.task_type === 'qiumi_task') {
    console.log(`[executor] 路由决策: task_type=qiumi_task → openclaw-agent executor (run_id=${task.payload?.run_id})`);
    const { triggerOpenclawAgent } = await import('./openclaw-agent-executor.js');
    return triggerOpenclawAgent(task);
  }
```
`scheduler-jobs.js`：import `reapOpenclawAgentRuns`，JOBS 追加上文那行。

- [ ] **Step 5: 跑测试转绿**：`npx vitest run src/__tests__/openclaw-agent-executor.test.js src/__tests__/scheduler-jobs-openclaw-reaper.test.js src/__tests__/executor-contracts-openclaw-agent.test.js` → 全绿。变异：把 `SAFE` 校验删掉 → 注入用例红；把 `AND status = 'in_progress'` 从收割 UPDATE 删掉 → 断言红；还原绿。
- [ ] **Step 6: commit-2** `feat(brain): openclaw-agent 执行体——ssh nohup 起 agent(prompt 走 stdin)、.log/.exit/.pid 三件套、收割→completed_no_pr/failed+receipt；executor 0.7 分支；reaper job`

---

### Task 6: 切换脚本 + 在途检查 + 真库 smoke + 登记 + 影子跑 runbook

**Files:**
- Create: `packages/brain/scripts/ops/qiumi-cutover.sh`、`packages/brain/scripts/ops/qiumi-inflight-check.mjs`
- Create: `packages/brain/scripts/smoke/qiumi-routing-smoke.sh`、`packages/brain/scripts/smoke/qiumi-routing-smoke.mjs`
- Modify: `packages/quality/smoke-allowlist.txt`（字母序插入 `qiumi-routing-smoke.sh`，位于 `qiumi-foundation-smoke.sh` 之后）
- Create: `docs/runbooks/qiumi-cutover.md`
- Test: `packages/brain/src/__tests__/qiumi-cutover-guard.test.js`

**Interfaces:**
- `qiumi-inflight-check.mjs`：读 env `NOTION_TOKEN`（或 1Password 取法见 runbook）、`NOTION_GTD_DB_ID`；查中文表 `状态=进行中 ∧ OpenClaw任务号 非空`，过滤掉前缀 `brain:`/`en:`/`relay-` 的行；输出 JSON `{ inflight: n, ids: [...] }`；`n>0` exit 2。
- `qiumi-cutover.sh`（幂等，每步可单跑 `--step N`）：① `ssh us-vps` 把 crontab 里含 `notion-qiumi-delegate.py` 的行注释（已注释则跳过）；② 循环调 `qiumi-inflight-check.mjs` 直到 0（超时 30min 退出 3）；③ 在 us-vps Brain env 文件追加/更新 `QIUMI_SYNC_ENABLED=true`、`QIUMI_DISPATCH_ENABLED=true`、`QIUMI_SYNC_SINCE=<now ISO>`（幂等 sed），并提示"需重建容器"；④ `psql`（DATABASE_URL 由调用方给，必须是生产库时脚本要求 `--confirm-prod`）：`UPDATE tasks SET payload = payload - 'headed_manual' WHERE task_type='qiumi_task' AND status='queued'`；`UPDATE ops_schedule_entries SET active=FALSE, updated_at=NOW() WHERE label ILIKE '%notion-qiumi-delegate%'`；`INSERT INTO ops_schedule_entries (source, host_alias, label, kind, schedule_desc, active) VALUES ('brain','us-vps','qiumi-router+openclaw-agent-reaper','brain_recurring','tick 2min 派发 / reaper 60s',TRUE) ON CONFLICT (source, host_alias, label) DO UPDATE SET active=TRUE, updated_at=NOW()`。
- 守卫（`qiumi-cutover-guard.test.js`）：① `qiumi-cutover.sh` 文本必须含 `--confirm-prod` 闸与 `inflight` 检查调用；② 变异：把脚本里 `inflight` 检查行删掉的副本必须让守卫红（用 fs 读脚本 + 正则断言）；③ PR2 的 `pullMarkedNotionTasks`/`ingestQiumiPage` 对 `OpenClaw任务号` 非空的中文行不认领（该断言若 PR2 已有则引用，没有则补）。
- smoke（cecelia_test）：`.sh` 守卫照 `qiumi-foundation-smoke.sh:10-35`，然后 `node qiumi-routing-smoke.mjs`（env `QIUMI_JEV_STUB`、`QIUMI_SSH_STUB`）：闸1 插入 `qiumi_task`（正文"用 Claude Code 改按钮"）→ `routeQiumiTask` with stub Jev → `persistDecision` → 断言 `payload.model='claude-cli/claude-sonnet-5'`、`run_id` 合规、`task_events` 有 `qiumi_route_decided`；闸2 插入正文含 `ops_agents` 里一条测试 agent（脚本先插 `ops_agents` 行 `name='phone-SMOKE1'`, `meta.serial='SMOKE1'`，事后删）→ 断言 `task_type='device_job'`、`assigned_to='phone-SMOKE1'`、`payload.serial='SMOKE1'`、`claimed_by IS NULL`；闸3 Jev stub 返回 `is_device=true conf=0.6` → `status='failed'`、`error_message` 以 `device_uncertain` 开头；闸4 `reapOpenclawAgentRuns` with `execFileFn` stub 返回 `EXIT=0` → `completed_no_pr` 且 `result->'receipt'->>'exit'='0'`；闸5 对照组：stub 返回 `NO_EXIT` → 仍 `in_progress`；清理自己插的行。

- [ ] **Step 1: 写失败守卫测试**

```js
// packages/brain/src/__tests__/qiumi-cutover-guard.test.js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../../');
const sh = () => fs.readFileSync(path.join(ROOT, 'scripts/ops/qiumi-cutover.sh'), 'utf8');

describe('qiumi-cutover.sh 守卫', () => {
  it('存在且含生产确认闸与在途检查', () => {
    const s = sh();
    expect(s).toMatch(/--confirm-prod/);
    expect(s).toMatch(/qiumi-inflight-check\.mjs/);
    expect(s).toMatch(/notion-qiumi-delegate\.py/);
    expect(s).toMatch(/payload - 'headed_manual'/);
    expect(s).toMatch(/ops_schedule_entries/);
  });
  it('变异：去掉在途检查的副本必须被守卫抓住', () => {
    const mutated = sh().replace(/.*qiumi-inflight-check\.mjs.*\n/g, '');
    expect(mutated).not.toMatch(/qiumi-inflight-check\.mjs/);
  });
  it('smoke 已登记 allowlist 且字母序', () => {
    const lines = fs.readFileSync(path.join(ROOT, '../quality/smoke-allowlist.txt'), 'utf8').split('\n').filter(Boolean);
    const i = lines.indexOf('qiumi-routing-smoke.sh');
    expect(i).toBeGreaterThan(-1);
    expect(lines[i - 1] <= lines[i] && (lines[i + 1] === undefined || lines[i] <= lines[i + 1])).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → `ENOENT scripts/ops/qiumi-cutover.sh`
- [ ] **Step 3: commit-1** `test(brain): 秋米切换脚本守卫（生产确认闸/在途检查/存量 headed_manual 清理/台账更新/allowlist 登记）先红`
- [ ] **Step 4: 实现脚本与 smoke**

`scripts/ops/qiumi-inflight-check.mjs`：
```js
#!/usr/bin/env node
// 在途检查：旧脚本认领（OpenClaw任务号 非 brain:/en:/relay- 前缀）且状态=进行中 的中文行数。n>0 → exit 2。
const DB = process.env.NOTION_GTD_DB_ID || 'c69c40c2-ba63-8271-badf-01c5410d8929';
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error('NOTION_TOKEN required'); process.exit(1); }
const res = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
  body: JSON.stringify({ page_size: 100, filter: { and: [{ property: '状态', status: { equals: '进行中' } }, { property: 'OpenClaw任务号', rich_text: { is_not_empty: true } }] } }),
});
const json = await res.json();
const ids = (json.results ?? []).filter((p) => { const t = (p.properties?.['OpenClaw任务号']?.rich_text ?? []).map((x) => x.plain_text).join(''); return !/^(brain:|en:|relay-)/.test(t); }).map((p) => p.id);
console.log(JSON.stringify({ inflight: ids.length, ids }));
process.exit(ids.length > 0 ? 2 : 0);
```

`scripts/ops/qiumi-cutover.sh`：
```bash
#!/usr/bin/env bash
# 秋米路由切换（PR3）：退役 us-vps 旧 cron → 等在途清零 → 打开 QIUMI_* 开关 → 清存量 headed_manual → 更新排程台账。
# 幂等，可 --step N 单跑。生产库操作必须显式 --confirm-prod。
set -euo pipefail
STEP="${STEP:-all}"; CONFIRM_PROD=0
for a in "$@"; do case "$a" in --step=*) STEP="${a#--step=}";; --confirm-prod) CONFIRM_PROD=1;; esac; done
: "${DATABASE_URL:?DATABASE_URL required}"; : "${BRAIN_ENV_FILE:=/opt/cecelia/.env}"; : "${US_VPS:=us-vps}"
HERE="$(cd "$(dirname "$0")" && pwd)"
log() { printf '[cutover %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
run_step() { [[ "$STEP" == "all" || "$STEP" == "$1" ]]; }

if run_step 1; then
  log "step1 注释 us-vps 旧 cron（notion-qiumi-delegate.py）"
  ssh -o BatchMode=yes "$US_VPS" 'crontab -l | sed -E "/^[^#].*notion-qiumi-delegate\.py/ s/^/#[retired-qiumi-cutover] /" | crontab -' 
  ssh -o BatchMode=yes "$US_VPS" 'crontab -l | grep -c "notion-qiumi-delegate.py" | xargs -I{} echo "  cron 行数={} (应含 #[retired-qiumi-cutover] 前缀)"'
fi
if run_step 2; then
  log "step2 等旧脚本在途清零（最长 30min）"
  for i in $(seq 1 60); do
    if node "$HERE/qiumi-inflight-check.mjs"; then break; fi
    [[ $i -eq 60 ]] && { log "在途未清零，退出 3"; exit 3; }
    sleep 30
  done
fi
if run_step 3; then
  log "step3 打开开关（$BRAIN_ENV_FILE，需重建容器 learning cp-0916213853）"
  NOW="$(date -u +%FT%TZ)"
  for kv in "QIUMI_SYNC_ENABLED=true" "QIUMI_DISPATCH_ENABLED=true" "QIUMI_SYNC_SINCE=${NOW}"; do
    k="${kv%%=*}"
    ssh -o BatchMode=yes "$US_VPS" "grep -q '^${k}=' '$BRAIN_ENV_FILE' && sed -i.bak 's#^${k}=.*#${kv}#' '$BRAIN_ENV_FILE' || echo '${kv}' >> '$BRAIN_ENV_FILE'"
  done
  log "  已写入；请执行 Brain 容器重建后继续 step4"
fi
if run_step 4; then
  DB_NAME="$(node -e 'const u=new URL(process.argv[1]);process.stdout.write(decodeURIComponent(u.pathname.slice(1)))' "$DATABASE_URL")"
  if [[ ! "$DB_NAME" =~ (_test|_scratch)$ && $CONFIRM_PROD -ne 1 ]]; then log "生产库 ${DB_NAME} 需 --confirm-prod"; exit 4; fi
  log "step4 清存量 headed_manual + 排程台账（库=${DB_NAME}）"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "UPDATE tasks SET payload = payload - 'headed_manual', updated_at = NOW() WHERE task_type='qiumi_task' AND status='queued';"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "UPDATE ops_schedule_entries SET active=FALSE, updated_at=NOW() WHERE label ILIKE '%notion-qiumi-delegate%';"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "INSERT INTO ops_schedule_entries (source, host_alias, label, kind, schedule_desc, active) VALUES ('brain','us-vps','qiumi-router+openclaw-agent-reaper','brain_recurring','tick 2min 派发 / reaper 60s',TRUE) ON CONFLICT (source, host_alias, label) DO UPDATE SET active=TRUE, updated_at=NOW();"
fi
log "done"
```

`scripts/smoke/qiumi-routing-smoke.sh`（前 30 行照 `qiumi-foundation-smoke.sh` 的 DATABASE_URL/库名/host 守卫），然后：
```bash
export QIUMI_JEV_STUB QIUMI_SSH_STUB
"$NODE" "$(dirname "$0")/qiumi-routing-smoke.mjs"
```
`scripts/smoke/qiumi-routing-smoke.mjs`（要点，完整写出）：用 `pg` 连 `DATABASE_URL`；`T='[smoke] qiumi-routing '+process.pid`；`cleanup()` 删 `tasks WHERE title LIKE T%`、`ops_agents WHERE name='phone-SMOKE1'`、`task_events WHERE task_id IN (...)`；闸1–5 按 Interfaces 描述，`fetchFn` 用 `QIUMI_JEV_STUB` 的 JSON 构造 `{ok:true,json:async()=>stub}`，`execFileFn` 按 `QIUMI_SSH_STUB`（`ok` → `DISPATCHED`/`EXIT=0\n{"finalAssistantVisibleText":"smoke ✓"}`；`noexit` → `NO_EXIT`）；每闸 `pass()`/`fail()`。

`docs/runbooks/qiumi-cutover.md`：影子跑一轮（打开 `QIUMI_SYNC_ENABLED` 但 `QIUMI_DISPATCH_ENABLED=false` 观察 24h：入账正确、无双认领）→ step1–4 → 观察 `task_events` 与中文表回写 → 回滚（取消 cron 注释 + 关开关 + 重建容器）。

- [ ] **Step 5: 跑守卫与 smoke**：`npx vitest run src/__tests__/qiumi-cutover-guard.test.js` → 3 passed；`DATABASE_URL=postgresql://cecelia@localhost:5432/cecelia_test QIUMI_JEV_STUB='{...}' QIUMI_SSH_STUB=ok bash scripts/smoke/qiumi-routing-smoke.sh` → 5 闸 ALL PASS，输出贴进报告。变异：临时把 smoke 闸3 的 stub 置信改 0.9 → 闸3 必红（说明 fail-closed 真起作用）；还原。
- [ ] **Step 6: commit-2** `feat(brain): 秋米切换脚本（幂等四步+生产确认闸+在途清零）+ 在途检查 + 路由真库 smoke 五闸 + allowlist + runbook`

---

## 自审
- spec 1.6 覆盖：路由插入点（Task 4）、便宜闸（Task 2）、Jev 阶梯（Task 1）、设备转换（Task 3/4）、并发闸（Task 4）、ssh 执行/收割（Task 5）、切换（Task 6）、task_events 留痕（Task 3/5）；spec 3 错误处理各行均有对应分支；spec 5 配置见 `routing/env.js`。
- 与 PR2 接口：只读 `qiumi_source`/`executor_kind`/`headed_manual`，新增 `QIUMI_DISPATCH_ENABLED` 控制 PR2 的 `headed_manual` 写入（Task 4）。
- 无 TBD；名称一致：`routeQiumiTask/persistDecision/dispatchQiumiTask/triggerOpenclawAgent/reapOpenclawAgentRuns/buildRemoteCommand/buildJevQuestions/decideWithFallback/cheapGates/loadRegistryPool/qiumiEnv/redactSecrets`。

## 与 spec 1.6 / PR2 计划不符之处（已按现实调整）
1. spec 写 Jev 只问 `engine/is_device/account`；按决策 df67a9d6 扩为六问（+kind/department/workflow_ref），为 PR4 任务模型收敛预留，不新增任何映射表。
2. spec 说"事务内改 device_job"；实现用单条 `UPDATE … WHERE status='queued'` CAS（761f242b），无需显式事务。
3. spec 写并发闸在执行体；实现放在 dispatcher 出口（claim 已持有时释放更干净，照 `codex_pool_full` 先例）。
4. `lib/ssh-args.js` 在本 worktree 尚不存在（PR1 终审修复 I6 才抽出）：开工前 rebase；若仍缺，Task 5 Step 0 创建同名模块（值 = `notion-push-sync.js:449` 原样）。
5. 切换脚本 step3 只写 env 文件，容器重建是人工动作（learning cp-0916213853：改 env 不重建等于没改），runbook 明示。

## 补充一（PR2 Task 4 审查后）：PR2 期 `qiumi_task` 双闸
PR2 已把 `qiumi_task` 打进注册表 `TICK_DISPATCH_EXCLUDED`（与 `payload.headed_manual` 构成双闸，比照 device_job）。PR3 Task 4 接线时必须：① 从 `TICK_DISPATCH_EXCLUDED` 移除 `qiumi_task`（改 registry tag + 同步 `task-type-registry.test.js` fixture）；② `QIUMI_DISPATCH_ENABLED` 门控 `headed_manual`；③ 切换脚本对存量 queued 任务 `payload - 'headed_manual'`。守卫：断言 `QIUMI_DISPATCH_ENABLED!=='true'` 时 `selectNextDispatchableTask` 不会选中 `qiumi_task`（变异去掉门必红）。

## 补充二（2026-09-23 实测 Jev 响应形状，Task 1 审查 Important）
- `noul` 型返回 `{"type":"noul","noul":0.95}`：`noul` = true 的概率，**无 `confidence`**。客户端读 `a.noul`；`is_device` 判定：`noul ≥ 0.8` → true，`≤ 0.2` → false，其间 → `ambiguous`（fail-closed：不派，failed + 原因）。
- `choice` 型返回 `{"type":"choice","choice":"workflow","confidence":0.05,"probabilities":{"workflow":0.52,"agent":0.48}}`：`confidence` 是**边际**（top1−top2），不是概率。Task 3 对 engine/kind/department 的采纳规则：`probabilities[choice] ≥ 0.6` 或 `confidence ≥ 0.2`，否则视为未判定→走便宜闸/默认（engine 默认 terra；kind 默认 agent；department 默认 main），并留痕。

## 补充三（Task 2 审查：注册表真身，2026-09-23）
Task 2 原计划假设 `ops_agents.meta.serial`/`.phone_serial` 与 `ops_workflows.meta.channel` 存在，
team-lead 核实生产 `ops-collector.js`（:100 白名单、:1177 只写 stages/canvas）不写这两个字段——落空。改正后的注册表真身：

- **手机序列号**：不在 `ops_agents`，真身是 `device_locks`（migrations/448）。`device_name` 即序列号，
  `device_type='phone'` 过滤，4 台种子机（xian-m1: `ANGYVB4311010223`/`e6c7ef34`；xian-m4: `ANGYVB4227006983`/`ANGYVB4402004137`）。
  `loadRegistryPool` 现查三源：`ops_agents`（name/notionId）+ `device_locks WHERE device_type='phone'`（serial/host）+ `ops_workflows`（name/notionId）。
- **设备工作流判定**：`ops_workflows` 无 `channel` 列，不能查表判定。改为 `isDeviceWorkflow(name, env)`——工作流名是否含任一
  `env.deviceKeywords`，诚实的启发式，不假装有 channel 列。
- **agent 命中 relation 但非部门**：不再把任意 agent 名当 `department`（原实现的隐式假设）。只有
  `agHit.name ∈ env.departments` 才写 `department`；否则写新增字段 `agentRef`（`cheapGates` 返回值新增，默认 `null`）。
- **部门文本命中**加引导词守卫（让/叫/找/由 + 部门名，且后不紧贴 ASCII 字母数字），防"main 分支""dev 环境"这类
  纯前缀重合误判部门。

**对 Task 3（Jev 客户端/六问 department 兜底）与 Task 4（路由插入点）的接口变化：**
- `pool.agents` 不再带 `serial` 字段；账号池 = `pool.phones` 的 `serial` 列表（不是原计划的
  `agents.filter(a => a.serial)`）。Task 3/4 凡是要"选一台手机"的地方，改查 `pool.phones`。
- `cheapGates()` 返回新增 `agentRef: string|null`——relation 命中了具体 agent 但该 agent 不是部门时的落点，
  Task 4 路由插入点决定是否要把 `agentRef` 透传进 `task_events` 留痕（不强制消费，只是不能再丢弃这条信息）。
- `pool.workflows` 不再带 `channel` 字段，Task 3/4 若有代码直接读 `workflow.channel` 判设备需要改成调用
  `cheap-gates.js` 导出的判定逻辑（当前未单独导出 `isDeviceWorkflow`，如 Task 3/4 需要复用，按最小改动加一个具名 export）。

详见 `packages/brain/src/routing/cheap-gates.js` 实现与 `packages/brain/src/__tests__/qiumi-cheap-gates.test.js`
17 个用例；报告 `.superpowers/sdd/task-2-report.md` 的「审查后修复」节。

## 补充四（Task 4 审查：接线点上移到 claim 之后、标 in_progress 之前）

**Critical 根因（计划层错误，不是实现走样）**：原计划把 `qiumi_task` 的接线点放在
`let taskToDispatch = fullTaskResult.rows[0];` 之后。那个位置已经过了
`updateTask({status:'in_progress'})`，任务状态不再是 `queued`：

- `persistDecision` 的三条分支里 device 与 fail 都带 `AND status = 'queued'` 的 CAS
  （761f242b 的防覆盖设计）→ 全部 0 行：设备没转成 `device_job`、判定失败没落 `failed`、
  claim 也没跟着放掉。dispatcher 却照样返回 `qiumi_routed_device` / `qiumi_route_failed`，
  账实分叉。
- 并发闸 `count(*) WHERE executor_kind='openclaw-agent' AND status='in_progress'` 把任务
  自己数了进去，上限 2 实际只剩 1。
- 闸满与 spawn 失败两条路只把 `claimed_by` 置 NULL，没把 `status` 退回 `queued`
  → 任务永久卡在 `in_progress`，既不会被再次派发，又一直占着并发闸。

**修订后的接线点**：候选循环内，原子 claim 成功之后、`applyDispatchAllocationGuide` 之前
（锚点闸之后，不改其它类型的闸序）。此处任务仍是 `queued`，CAS 与并发闸都成立。

```js
if (candidate.task_type === 'qiumi_task') {
  const q = await dispatchQiumiTask(candidate, { actions, holSkipIds });
  if (q.outcome === 'return') return q.result;   // device / fail / P0 闸满
  if (q.outcome === 'skip') { /* 非 P0 闸满：claim 已放、已进 holSkipIds */ attempt--; continue; }
  nextTask = candidate;                           // 'proceed'：agent 决策已落库
  break;
}
```

`dispatchQiumiTask(task, deps)` 的返回体改成三态，不再自己 spawn：

| outcome | 何时 | 副作用 |
| --- | --- | --- |
| `return` | device / fail / P0 闸满 | 已 `persistDecision` 或已释放 claim，`result` 里带累计 `actions` |
| `skip` | 非 P0 闸满 | 释放 claim、`holSkipIds.push(id)`，交回循环换下一个候选（cap 与 codex HOL 分支同处理） |
| `proceed` | agent 决策 | payload 已 merge model/run_id，回主流程标 in_progress → 读全行 → `triggerCeceliaRun` |

agent 分支不再在函数内 spawn，也不再自己重读库：主流程本来就会在标 in_progress 之后
`SELECT * FROM tasks`，拿到的正是 `persistDecision` 刚写进去的 payload；spawn 失败沿用主流程
既有的回滚（释放 claim + 退回 queued）。

**连带修正（Task 4 实现时实测）**：`qiumi_task` 必须进 `ANCHOR_EXEMPT_TASK_TYPES`（注册表 `ANC` 标签）。
放开第二道闸之后这类任务要过 dispatcher 的锚点执法闸（`checkAnchor`，dispatcher.js 3c''），
而入账链（`ingestQiumiPage` → `createRoutedTask`）从不写 `payload.anchor`，闸的判据是
`anchor.{journey_id,gp_id,step_id}` 三件齐全 → 每一条秋米任务都会在路由之前被终态 `failed`
（`failure_class=missing_anchor`）。秋米任务是主理人从 Notion 排的运营活，不走承诺地图锚点，
与 `research`/`talk`/`device_job` 同类，按 `ANC` 豁免。

**Task 5 接口影响**：`triggerOpenclawAgent` 的状态 CAS 要放宽成 `status IN ('queued','in_progress')`
（主流程先标 in_progress 才 spawn）。

## 补充五（Task 6 实测：回执不可变触发器挡死 device 转换 → 改成派生子任务）

**Critical 根因（计划层错误）**：原计划让 `persistDecision` 的 device 分支就地改写任务
`UPDATE tasks SET task_type='device_job' …`。`tasks` 上有触发器
`work_routing_task_projection_immutable`（迁移 421，`BEFORE UPDATE OF task_type, payload`）：
任务在 `work_routing_receipts` 有回执时，`NEW.task_type` 与 `receipt.canonical_task_type`
不一致即 `RAISE EXCEPTION`。生产秋米任务全部经 `ingestQiumiPage` → `createRoutedTask` 入账，
回执 `canonical_task_type='qiumi_task'`，所以这条 UPDATE 在生产必抛。

**这是硬不变量，不绕过**：回执是"这件活当初被路由成什么"的账，任务行是它的投影。
改投影不改真身 = 账实分叉，正是触发器要挡的东西。所以改成**派生子任务**——
父任务（`qiumi_task`）保留自己的回执不动，设备那一段作为独立的 `device_job` 子任务落地，
子任务经 `createRoutedTask` 拿自己的回执（`canonical_task_type='device_job'`，与它的
`task_type` 一致，触发器天然放行）。

### 1. `persistDecision` device 分支：派生子任务 + 父任务挂起

子任务建单走 `createRoutedTask`（仓内唯一的建单路径，全仓没有第二处建 `device_job` 的代码；
`scripts/smoke/device-job-foundation-smoke.sh` 那条是裸 INSERT 探针，不是生产路径）：

| 字段 | 值 | 来源 |
| --- | --- | --- |
| `source` / `source_id` | `'child'` / `qiumi-device:<父任务 id>` | 天然幂等键：同一父任务重复路由只会拿回同一个子任务 |
| `requested_task_type` | `'device_job'` | 非编码分支 `canonical_task_type = requested_task_type`（work-router.js:155） |
| `mutation_intent` / `declared_domain` | `'none'` / `'operations'` | → `work_kind='operations'`，非编码，不解析 repo、不要 map_scope、不要 impact 合同 |
| `task.trigger_source` / `executor_kind` | `'manual'` / `'headed-session'` | 领单器认这两个 |
| `task.priority` / `project_id` / `title` / `description` | 继承父任务 | |
| `payload`（走 `metadata`） | `qiumi_source` 摘要、`serial`、`source:'oneoff'`、`headed_manual:true`、`parent_task_id`、`qiumi_workflow_ref`、`qiumi_route`、`tenant_id`、`notion_page_id` | 前四项是领单器的消费契约；后面是溯源 |

`assigned_to='phone-<serial>'` 由建单后另一条 `UPDATE tasks SET assigned_to=…` 写
（`createRoutedTask` 的 INSERT 列表里没有 `assigned_to`）。这条 UPDATE **不碰
`task_type`/`payload`**，触发器是 `UPDATE OF task_type, payload`，不会被触发。

**坑一（子任务标题必须带设备后缀）**：`idx_tasks_dedup_active` 是
`(title, goal_id, project_id) WHERE status IN ('queued','in_progress') AND payload->>'notion_page_id' IS NULL`
的唯一索引（迁移 461）。**建子任务这一刻父任务还是 `queued`**（挂 `blocked` 在建单之后），
子任务标题若逐字照抄父任务，父子两行当场撞索引——2026-09-23 smoke 实证：

```
FAIL 异常：error: duplicate key value violates unique constraint "idx_tasks_dedup_active"
    at async Module.createRoutedTask (src/work-routing-store.js:308:24)
    at async delegateDeviceJob (src/routing/qiumi-router.js:228:18)
```

所以子任务标题是 `<父标题截 200 字>（设备 <序列号>）`。顺带让排程看板上父子两行分得清谁是哪个。
不改成"先挂父任务再建子任务"来规避：那条路上子任务建失败时父任务会挂在 `blocked` 却没有
`device_task_id`，对账 job 捞不到它（候选条件要求该键非空），变成真正的永久卡死。

`notion_page_id` 仍然要继承：中文表里同名行是常态（461 的立案理由就是"朋友圈点赞测试 ×4"），
Notion 来源的任务靠这个键豁免 title 去重，子任务是同一条 Notion 行派生的活，语义上也该带着它。

父任务落挂起（一条 UPDATE，带 `AND status='queued'` 的 CAS，与 761f242b 同款）：

```sql
UPDATE tasks
   SET status='blocked', blocked_at=NOW(), blocked_reason='delegated_device_job',
       claimed_by=NULL, claimed_at=NULL,
       payload = COALESCE(payload,'{}'::jsonb) || $2::jsonb, updated_at=NOW()
 WHERE id=$1 AND status='queued'
```

`$2` 只含 `{device_task_id, qiumi_route, qiumi_workflow_ref}`——**绝不碰回执七键**
（`routing_receipt_id` / `work_kind` / `change_kind` / `default_execution_profile` /
`execution_profile_override` / `repo` / `map_scope` / `impact_contract_required`），
否则同一个触发器换个理由照抛。`serial`/`source:'oneoff'`/`headed_manual` 属于设备语义，
只写子任务，不往父任务上糊。

不用 `task-updater.js` 的 `blockTask()`：它吃模块级 `pool`（不接受注入，单测与 smoke 都注不进去）、
不做 `status='queued'` 的 CAS、也不合并 payload，三条都对不上。列名与它逐字一致
（`blocked_at`/`blocked_reason`），账本读法不变。

**坑二（没有 TTL 是故意的）**：`blocked_until` 留 NULL。`releaseBlockedTasks()` /
`unblockExpiredTasks()` 只捞 `blocked_until <= NOW()` 的行，留 NULL 才不会被自动解闸器
在子任务跑完之前抢着放回 `queued`（那会让同一件活派两遍）。放行权唯一归下面的对账 job。

幂等：父任务 payload 已有 `device_task_id` 就直接返回，不再建子任务——`createRoutedTask`
的去重分支会走 `assertRouteSnapshotLaunchAuthority`，子任务还 `queued` 且
`map_scope_validation_version` 为 NULL（非编码任务本来就不写这列）时它会抛
`legacy_route_snapshot_unvalidated`。这是共用路由账房的既有锐边，不在本刀修，绕开即可。

留痕 `qiumi_device_delegated {child_id, serial, workflowRef}`（原 `qiumi_device_converted`
语义已变，改名而不是留着骗人）。

### 2. 新模块 `packages/brain/src/routing/device-delegation.js`

`reconcileDelegatedDeviceJobs(pool) → {checked, completed, failed}`：捞父任务
（`task_type='qiumi_task' AND status='blocked' AND blocked_reason='delegated_device_job'
AND payload->>'device_task_id' IS NOT NULL`，`LIMIT 50`），逐条读子任务状态：

| 子任务 status | 父任务落点 |
| --- | --- |
| `completed` / `completed_no_pr` | `completed_no_pr` + `result.receipt = {device_task_id, child_status, child_result, reaped_at}` |
| `failed` / `cancelled` / `canceled` | `failed` + `error_message='device_job_<childStatus>'` |
| 其它（含子任务行不存在） | 不动 |

两条写回都带 `AND status='blocked'` 的 CAS。`blocked → completed_no_pr` 与
`blocked → failed` 都已在 `lib/task-status-transitions.js` 的 `WAITING_EXITS` 里
（0921 那刀补的），**不需要动 PR1 的状态机**。写回只改 `status`/`result`/`error_message`/
`completed_at`，不碰 `payload`/`task_type` → 触发器不参与。留痕 `qiumi_device_reconciled`。

### 3. scheduler 注册

`scheduler-jobs.js` 追加 `qiumi-device-reconcile`（`needsPool`，60s loop，紧挨
`openclaw-agent-reaper`）。不注册 = 父任务永远挂在 `blocked`，中文表永远停在「进行中」。

### 4. dispatcher 与 smoke

`dispatcher.js` 的 device 出口语义不变（仍 `return` + `qiumi_routed_device`，claim 已由
`persistDecision` 释放）。派发候选 SQL 要求 `t.status='queued'`，`blocked` 的父任务自然
选不中；子任务 `task_type='device_job'` 撞 `TICK_DISPATCH_EXCLUDED` 黑名单 + payload
`headed_manual=true` 第一道闸，两道闸都在。

`scripts/smoke/qiumi-routing-smoke.mjs` 闸 2 从直插改成**真实回执路径**（这是本补充的关键证据：
修前它必须抛 `work_routing_task_projection_immutable`）：`createRoutedTask` 建父任务 → route →
`persistDecision` → 断言父 `blocked`/`delegated_device_job`/`payload.device_task_id`、
子 `device_job`/`phone-SMOKE1`/`payload.serial`/`parent_task_id`；再把子任务置 `completed`
跑 `reconcileDelegatedDeviceJobs` → 父 `completed_no_pr` 且 `result.receipt.device_task_id` 对上。
`work_routing_receipts` 是 append-only 且外键顶着 `tasks`，这两行删不掉 → 清理改为**归档**
（改名 `[smoke-residue] …` + `status='archived'`），照 Task 6 对那条探针残留的处置。
