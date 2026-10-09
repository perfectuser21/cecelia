# 秋米手机活改走 OpenClaw agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增开关 `QIUMI_DEVICE_DELEGATION_ENABLED`（默认关）；关时秋米手机活不再派生 `device_job`，一律走 agent 分支并在 `qiumi_route.device_hint` 留痕，agent prompt 追加设备提示段。

**Architecture:** 三个文件各加一小段：`routing/env.js` 读开关与节点名映射；`routing/qiumi-router.js` 用 `env.deviceDelegationEnabled` 把三道 device 闸包起来，agent 分支产出 `device_hint`；`openclaw-agent-executor.js` 的 `promptOf` 按 `device_hint` 拼提示段。旧行为在开关开时逐字保留。

**Tech Stack:** Node 26 ESM、vitest、pg mock。spec：`docs/superpowers/specs/2026-09-23-qiumi-phone-via-openclaw-design.md`。

---

## Global Constraints（每个 Task 都适用）

- **NO PRODUCTION CODE WITHOUT FAILING TEST FIRST**。每 Task 两段 commit：commit-1 只含测试且跑红；commit-2 实现转绿。
- 固定测试命令（禁全量）：`cd packages/brain && npx vitest run src/routing/__tests__/qiumi-router.test.js src/__tests__/openclaw-agent-executor.test.js src/__tests__/dispatcher-qiumi-routing.test.js`
- 不新建测试文件（lint-test-pairing 只认既有配套）。不碰版本五件套。不手抄手机/节点名单。
- `git add` 按文件名；`.superpowers/` 不入库。commit 尾行 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- bash-guard 拦 `sed -i` 改代码文件，用 Edit 工具。
- 变异测试：每个 Task 指定的变异必须复现红，再还原，证据写进 commit-2 body。

## File Structure

| 文件 | 职责 | 改动 |
|---|---|---|
| `packages/brain/src/routing/env.js` | 秋米路由环境读取 | 加 `deviceDelegationEnabled`、`phoneNodeMap`；导出 `phoneNodeName(host, env)` |
| `packages/brain/src/routing/qiumi-router.js` | 路由决策 | 三道 device 闸受开关控制；agent 分支产出 `device_hint` |
| `packages/brain/src/openclaw-agent-executor.js` | ssh 起 agent | `promptOf` 追加设备提示段 |
| `packages/brain/src/routing/__tests__/qiumi-router.test.js` | 路由用例 | 既有用例改用开关开的 env；新增开关三态 + 开关关五条 |
| `packages/brain/src/__tests__/openclaw-agent-executor.test.js` | 执行器用例 | 新增设备提示段三条 |
| `changes/cp-0923152540-qiumi-phone-via-openclaw.md` | DEFINITION 条目碎片 | 新建 |

---

### Task 0: env 开关三态 + 既有 device 用例显式开开关

**Files:**
- Modify: `packages/brain/src/routing/env.js:27-40`
- Test: `packages/brain/src/routing/__tests__/qiumi-router.test.js:25-27`（import 与 env 常量）+ 文件末尾新 describe

- [ ] **Step 1: 既有用例改用开关开的 env（纯测试改动，跑完仍全绿）**

把第 25-27 行改为：

```js
import { qiumiEnv, phoneNodeName } from '../env.js';

// 既有 device/fail 用例断言的是「device 派生」这条旧路，开关封存后必须显式打开才走得到
const env = qiumiEnv({ JEV_API_KEY: 'k', QIUMI_DEVICE_DELEGATION_ENABLED: 'true' });
// 默认（开关关）：手机活走 agent，见文件末尾「开关关（默认）」describe
const envDefault = qiumiEnv({ JEV_API_KEY: 'k' });
```

- [ ] **Step 2: 文件末尾追加开关三态用例**

```js
describe('QIUMI_DEVICE_DELEGATION_ENABLED 三态 + phoneNodeName', () => {
  it('缺失 → 关（默认走 agent）', () => {
    expect(qiumiEnv({}).deviceDelegationEnabled).toBe(false);
  });
  it("'1' → 关（只认字面 'true'，与 QIUMI_DISPATCH_ENABLED 同款）", () => {
    expect(qiumiEnv({ QIUMI_DEVICE_DELEGATION_ENABLED: '1' }).deviceDelegationEnabled).toBe(false);
  });
  it("'true' → 开", () => {
    expect(qiumiEnv({ QIUMI_DEVICE_DELEGATION_ENABLED: 'true' }).deviceDelegationEnabled).toBe(true);
  });
  it('phoneNodeName：host 大写 + -PHONE 派生；QIUMI_PHONE_NODE_MAP 可覆盖；无 host → null', () => {
    expect(phoneNodeName('xian-m4', qiumiEnv({}))).toBe('XIAN-M4-PHONE');
    expect(phoneNodeName('xian-m1', qiumiEnv({}))).toBe('XIAN-M1-PHONE');
    expect(phoneNodeName('xian-m4', qiumiEnv({ QIUMI_PHONE_NODE_MAP: '{"xian-m4":"M4-NODE"}' }))).toBe('M4-NODE');
    expect(phoneNodeName(null, qiumiEnv({}))).toBeNull();
  });
});
```

- [ ] **Step 3: 跑固定命令，确认红**

Expected: `phoneNodeName is not a function` / `deviceDelegationEnabled` 为 undefined 的断言红；既有用例因 `qiumiEnv` 忽略未知键仍绿。

- [ ] **Step 4: commit-1**

```bash
git add packages/brain/src/routing/__tests__/qiumi-router.test.js
git commit -m "test(brain): 秋米 device 派生开关三态 + phoneNodeName 派生（红）"
```

- [ ] **Step 5: 实现 env.js**

在 `qiumiEnv` 返回对象里加两项（`deviceKeywords` 之后）：

```js
    deviceDelegationEnabled: env.QIUMI_DEVICE_DELEGATION_ENABLED === 'true',
    phoneNodeMap: parseJson(env.QIUMI_PHONE_NODE_MAP, {}),
```

文件头注释表里补两行：

```
 *  QIUMI_DEVICE_DELEGATION_ENABLED 'true' 才把手机活派生成 device_job 交西安领单器；默认关＝手机活也派给 openclaw agent（主理人 0923 拍板）
 *  QIUMI_PHONE_NODE_MAP  JSON {host: OpenClaw 节点名}，缺省按 host 大写 + '-PHONE' 派生
```

文件末尾新增导出：

```js
/** 手机宿主 → OpenClaw 节点名。映射表优先，否则按 `<HOST>-PHONE` 派生（xian-m4 → XIAN-M4-PHONE）。 */
export function phoneNodeName(host, env = qiumiEnv()) {
  if (!host) return null;
  return env.phoneNodeMap?.[host] ?? `${String(host).toUpperCase()}-PHONE`;
}
```

- [ ] **Step 6: 跑固定命令，全绿；commit-2**

```bash
git add packages/brain/src/routing/env.js
git commit -m "feat(brain): 秋米路由环境新增 QIUMI_DEVICE_DELEGATION_ENABLED（默认关）与 phoneNodeName 派生"
```

---

### Task 1: 开关关时 routeQiumiTask 走 agent 并留痕 device_hint

**Files:**
- Modify: `packages/brain/src/routing/qiumi-router.js`（`routeQiumiTask` 内闸 1/闸 2/含糊闸 + agent 分支）
- Test: `packages/brain/src/routing/__tests__/qiumi-router.test.js` 文件末尾新 describe

- [ ] **Step 1: 写失败用例**

```js
describe('开关关（默认）：手机活不改道，走 agent 并留痕 device_hint', () => {
  it('便宜闸命中序列号 → agent；Jev 仍问一次（engine/department 要用）；device_hint 带 serial/host/matchedBy；不带 headed_manual', async () => {
    const fetchFn = jevOk();
    const d = await routeQiumiTask(task('用 ANGYVB4227006983 去点赞'), { pool, env: envDefault, fetchFn, callLLMFn: vi.fn() });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(d.outcome).toBe('agent');
    expect(d.payloadPatch.qiumi_route.device_hint).toMatchObject({ is_device: true, serial: 'ANGYVB4227006983', host: 'xian-m4' });
    expect(d.payloadPatch.qiumi_route.device_hint.matchedBy).toContain('text:serial');
    expect(d.payloadPatch).not.toHaveProperty('headed_manual');
    expect(d.payloadPatch).not.toHaveProperty('serial');
    expect(recordTaskEventSafe).toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_decided',
      expect.objectContaining({ outcome: 'agent', device_hint: expect.objectContaining({ serial: 'ANGYVB4227006983' }) }));
  });

  it('noul=0.85 + Jev 账号在池 → agent，device_hint.is_device=true、serial 取 Jev 账号、host 来自注册表', async () => {
    const d = await routeQiumiTask(task('把这条内容整理好交给同事'), {
      pool, env: envDefault,
      fetchFn: jevOk(jevAnswers({ is_device: { type: 'noul', noul: 0.85 }, account: choice('e6c7ef34', 0.9) })),
      callLLMFn: vi.fn(),
    });
    expect(d.outcome).toBe('agent');
    expect(d.payloadPatch.qiumi_route.device_hint).toMatchObject({ is_device: true, verdict: true, p: 0.85, serial: 'e6c7ef34', host: 'xian-m1' });
  });

  it('noul=0.5（ambiguous）→ agent 不 fail，device_hint.verdict=ambiguous、is_device=false、serial=null', async () => {
    const d = await routeQiumiTask(task('把这条内容整理好交给同事'), {
      pool, env: envDefault, fetchFn: jevOk(jevAnswers({ is_device: { type: 'noul', noul: 0.5 } })), callLLMFn: vi.fn(),
    });
    expect(d.outcome).toBe('agent');
    expect(d.payloadPatch.qiumi_route.device_hint).toMatchObject({ is_device: false, verdict: 'ambiguous', p: 0.5, serial: null, host: null });
    expect(recordTaskEventSafe).not.toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_failed', expect.anything());
  });

  it('noul=0.02 无手机 → agent，device_hint.is_device=false（不碰真机的活留痕也在）', async () => {
    const d = await routeQiumiTask(task('写一段周报'), { pool, env: envDefault, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d.outcome).toBe('agent');
    expect(d.payloadPatch.qiumi_route.device_hint).toMatchObject({ is_device: false, verdict: false, serial: null });
  });

  it('persistDecision(agent) 不调 createRoutedTaskFn，UPDATE payload 含 device_hint', async () => {
    const createRoutedTaskFn = vi.fn();
    const d = await routeQiumiTask(task('用 ANGYVB4227006983 去点赞'), { pool, env: envDefault, fetchFn: jevOk(), callLLMFn: vi.fn() });
    await persistDecision(pool, task('用 ANGYVB4227006983 去点赞'), d, { createRoutedTaskFn });
    expect(createRoutedTaskFn).not.toHaveBeenCalled();
    const upd = pool.query.mock.calls.find(([sql]) => /SET payload = COALESCE/.test(sql));
    expect(upd).toBeTruthy();
    expect(JSON.parse(upd[1][1]).qiumi_route.device_hint.serial).toBe('ANGYVB4227006983');
  });
});
```

- [ ] **Step 2: 跑固定命令，确认红**

Expected: 第 1/2/5 条 `outcome` 得到 `'device'`、第 3 条得到 `'fail'`；既有（开关开）用例仍绿。

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/routing/__tests__/qiumi-router.test.js
git commit -m "test(brain): 开关关时秋米手机活走 agent 并留痕 device_hint（红）"
```

- [ ] **Step 4: 实现 qiumi-router.js**

在 `routeQiumiTask` 里，`const device = async (...) => {...}` 定义之后、闸 1 之前插入：

```js
  // 开关关（默认）：手机活不改道给西安领单器，和其它活一样派 openclaw agent（主理人 0923 拍板）。
  // 三道 device 闸只在开关开时生效；关时 is_device/serial 仍算，但只留痕 device_hint 给 agent prompt 用。
  const delegate = env.deviceDelegationEnabled === true;
```

闸 1 改为：

```js
  if (delegate && cheap.isDevice && cheap.serial) return device(cheap.serial, 'cheap', null);
```

闸 2 与含糊闸包进 `if (delegate) { ... }`：

```js
  if (delegate) {
    // 闸 2：设备判定 fail-closed。便宜闸说是设备 → 直接进设备分支；否则只认 verdict===true。
    if (cheap.isDevice || verdict === true) {
      const serial = pickSerial(cheap, a, registry);
      if (!serial) return fail('device_serial_unresolved', `account=${a.account?.choice ?? 'none'}`, { source: r.source });
      return device(serial, r.source, a);
    }
    // 便宜闸未命中 + verdict 含糊（ambiguous）→ 不派，绝不回落 agent。
    // 这是 ambiguous 唯一的一道闸：删掉它 agent 分支就会照单全收，变异测试钉在这一行。
    if (verdict !== false) return fail('device_uncertain', `p=${a.is_device?.p ?? null}`, { source: r.source });
  }
```

agent 分支里 `const runId = ...` 之后、`payloadPatch` 之前加：

```js
  // 留痕给 agent：它要自己去 OpenClaw 节点上跑控制器，得知道哪台手机在哪台宿主。
  const hintSerial = pickSerial(cheap, a, registry);
  const device_hint = {
    is_device: cheap.isDevice || verdict === true,
    verdict: verdict ?? null,
    p: a.is_device?.p ?? null,
    serial: hintSerial,
    host: registry.phones.find((p) => p.serial === hintSerial)?.host ?? null,
    matchedBy: cheap.matchedBy,
  };
```

`payloadPatch.qiumi_route` 改为 `{ source: r.source, answers: a, defaulted, device_hint, ...base }`；`recordTaskEventSafe(... 'qiumi_route_decided', {...})` 的对象里加 `device_hint`。

- [ ] **Step 5: 跑固定命令，全绿**

- [ ] **Step 6: 变异（必做，做完还原）**

把闸 1 改回 `if (cheap.isDevice && cheap.serial) return device(...)`（去掉 `delegate &&`）→ 第 1 条与第 5 条红。还原后全绿。

- [ ] **Step 7: commit-2**

```bash
git add packages/brain/src/routing/qiumi-router.js
git commit -m "feat(brain): 秋米手机活默认不再改道 device_job，走 agent 并留痕 device_hint（开关开保留旧路）"
```

body 写变异证据。

---

### Task 2: promptOf 设备提示段

**Files:**
- Modify: `packages/brain/src/openclaw-agent-executor.js`（`promptOf` + import）
- Test: `packages/brain/src/__tests__/openclaw-agent-executor.test.js` 文件末尾新 describe

- [ ] **Step 1: 写失败用例**

```js
describe('promptOf 设备提示段（device_hint）', () => {
  const okPool = () => ({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) });
  const withHint = (hint) => ({ ...task, payload: { ...task.payload, qiumi_route: { device_hint: hint } } });
  const sentBody = (spawnFn) => String(spawnFn.child.stdin.end.mock.calls[0][0]);

  it('is_device=true → 正文含序列号、按 host 派生的节点名、控制器名、lock-acquire、timeout 300000', async () => {
    const spawnFn = spawnMock();
    await triggerOpenclawAgent(withHint({ is_device: true, serial: 'S1', host: 'xian-m4' }), { spawnFn, pool: okPool() });
    const body = sentBody(spawnFn);
    expect(body).toContain('设备提示');
    expect(body).toContain('S1');
    expect(body).toContain('XIAN-M4-PHONE');
    expect(body).toContain('douyin-phone-adb');
    expect(body).toContain('lock-acquire');
    expect(body).toContain('300000');
    // 原有三段仍在
    expect(body).toContain('token: SECRET 正文');
  });

  it('is_device=false 或没有 device_hint → 正文不含设备提示', async () => {
    const a = spawnMock();
    await triggerOpenclawAgent(withHint({ is_device: false, serial: null, host: null }), { spawnFn: a, pool: okPool() });
    expect(sentBody(a)).not.toContain('设备提示');
    const b = spawnMock();
    await triggerOpenclawAgent(task, { spawnFn: b, pool: okPool() });
    expect(sentBody(b)).not.toContain('设备提示');
  });

  it('host 缺失 → 节点名写「未知」并提示 openclaw nodes list，不抛', async () => {
    const spawnFn = spawnMock();
    await triggerOpenclawAgent(withHint({ is_device: true, serial: 'S2', host: null }), { spawnFn, pool: okPool() });
    const body = sentBody(spawnFn);
    expect(body).toContain('S2');
    expect(body).toContain('openclaw nodes list');
    expect(body).not.toContain('-PHONE');
  });
});
```

- [ ] **Step 2: 跑固定命令，确认红**（第 1、3 条 `toContain('设备提示')` 红）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/openclaw-agent-executor.test.js
git commit -m "test(brain): openclaw agent prompt 带设备提示段（红）"
```

- [ ] **Step 4: 实现**

在 `openclaw-agent-executor.js` 顶部 import 区加（若已有从 `./routing/env.js` 的 import 则合并）：

```js
import { qiumiEnv, phoneNodeName } from './routing/env.js';
```

`promptOf` 上方加：

```js
/** device_hint.is_device 时给 agent 的设备提示段；序列号/宿主来自路由留痕，节点名由宿主派生。 */
function deviceHintOf(task) {
  const h = task.payload?.qiumi_route?.device_hint;
  if (!h || h.is_device !== true) return null;
  const node = phoneNodeName(h.host, qiumiEnv());
  return [
    '设备提示（这是要碰真机的活，按 douyin-phone-runtime skill 执行）：',
    `- 手机序列号：${h.serial ?? '未定，按正文里的手机描述到节点的 douyin-phone-profiles.tsv 里查'}`,
    `- 宿主：${h.host ?? '未知'}；OpenClaw 节点：${node ?? '未知，先 openclaw nodes list 找带 PHONE 的节点'}`,
    '- 在该节点上执行 douyin-phone-adb --profile <profile> <command>（profile 按序列号在节点的 registry 查），禁止裸 adb',
    '- 先 lock-acquire <run_id>，结束必 lock-release 并回读 lock-status；每次 exec 显式 timeout 300000',
  ].join('\n');
}
```

`promptOf` 改为：

```js
function promptOf(task) {
  const s = task.payload?.qiumi_source ?? {};
  return [
    s.title,
    s.remark ? `补充说明：${s.remark}` : null,
    s.body ? `页面正文：\n${s.body}` : null,
    deviceHintOf(task),
  ].filter(Boolean).join('\n\n');
}
```

- [ ] **Step 5: 跑固定命令，全绿**

- [ ] **Step 6: 变异（必做，做完还原）**

从 `promptOf` 数组里删掉 `deviceHintOf(task),` → 第 1、3 条红。还原后全绿。

- [ ] **Step 7: commit-2**

```bash
git add packages/brain/src/openclaw-agent-executor.js
git commit -m "feat(brain): openclaw agent prompt 追加设备提示段（序列号/节点/控制器/锁）"
```

---

### Task 3: DEFINITION 条目碎片

**Files:**
- Create: `changes/cp-0923152540-qiumi-phone-via-openclaw.md`

- [ ] **Step 1: 写碎片**

```markdown
## Brain {VERSION} — 秋米手机活改走 OpenClaw agent：device_job 派生封存为开关（默认关）

- 主理人 0923 拍板：Notion → Brain → OpenClaw agent 一条链，手机活也走 agent。此前 Jev 判手机活即派生 `device_job` 交西安领单器，而领单器只认 `harvest_keyword/outreach_round/dm_one` 三种结构化单、Brain 又不填 `params`，自由文本手机活必失败。
- 新增 `QIUMI_DEVICE_DELEGATION_ENABLED`（只认 `'true'`，默认关）：关时 `routeQiumiTask` 三道 device 闸不生效，一律 agent 分支并留痕 `qiumi_route.device_hint = {is_device, verdict, p, serial, host, matchedBy}`；开时行为逐字保留（排程看板直接建的 `device_job` 不经此路径，不受影响）。
- `promptOf` 在 `device_hint.is_device` 时追加设备提示段：序列号、宿主、节点名（`QIUMI_PHONE_NODE_MAP` 或 `<HOST>-PHONE` 派生）、`douyin-phone-adb --profile`、`lock-acquire/lock-release`、exec timeout 300000。
- 守卫：qiumi-router.test.js 开关三态 + 开关关五条（含 persistDecision 不派生子任务），openclaw-agent-executor.test.js 设备提示三条；变异（去掉开关判断 / 删提示拼接）均验红。
```

- [ ] **Step 2: commit**

```bash
git add changes/cp-0923152540-qiumi-phone-via-openclaw.md
git commit -m "docs(brain): 秋米手机活改走 OpenClaw agent 条目碎片"
```

---

## Self-Review

- Spec ①→Task 0；②③→Task 1；④→Task 2；版本碎片→Task 3；E2E 复验在合并部署后由 lead 做（Notion 探针），不在本计划。
- 类型一致：`env.deviceDelegationEnabled`（boolean）、`env.phoneNodeMap`（object）、`phoneNodeName(host, env)`、`device_hint` 六键在 Task 1/2/3 与 spec 一致。
- 无占位符。
