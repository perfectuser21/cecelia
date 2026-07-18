# 设计：三轴执行体分配器（选择系刀2）

> 任务 600295fe（工厂 F1 开发交付线，锚 MJ5·S1）｜有头 Claude 主导（架构核心任务不外包）
> 上游：昨晚判官档位决策 51b9b095 + 产能配比 cec579d2 + 排序官 skill#159（消费方）

## 一、问题：选择逻辑散落，没有统一决策层

现状是"**task_type 硬映射到 location**"（`crystallize→xian`），不是"**按余额动态选执行体+机器**"。选择碎片散在各处：

| 轴 | 现有碎片 | 缺口 |
|----|---------|------|
| 账号轴 | `executor.js pickLocalAccountByDeficit`（Codex 按 5h% 选）+ Claude account-rotation | Grok 没接；三家无统一抽象 |
| 机器轴 | `task-router.js LOCATION_MAP` + `triggerCodexBridge`（西安 M4/M1 bridge） | 按 task_type 硬编码，不跟账号走 |
| 档位轴 | 无 | 判官档位表（51b9b095）未落地 |
| 原型 | `scripts/dispatch-worker.mjs` 已有 vendor 抽象（codex/claude/grok）+ deficit 选账号 | 是脚本，没进 Brain 决策层 |

**本刀 = 把散落选择逻辑收拢成一个纯函数**：给一个任务 → 输出 `{vendor, account, machine, model_tier, reason}`。不重造执行通道（bridge/rotation 都复用），只加决策层 + Grok 接入 + 档位表。

## 二、执行体资源表（已验证，非口述）

| Vendor | 数量·位置 | 余额查询 | 判官档位 | 工作档位 |
|--------|----------|---------|---------|---------|
| Claude Max | ×2，本机 us-m4 | ✅ account-usage（5h/7d，`isSpendingCapped`/`isAuthFailed`） | Opus 4.8 | Sonnet |
| Codex | ×2 本机 + ×3 西安 M4 | ✅ `pickLocalAccountByDeficit`（wham/usage 5h%） | GPT-5.6 Sol | GPT-5.6 Terra |
| Grok | ×1，本机 us-m4，`~/.grok/bin/grok`（v0.2.101，auth.json 已登录） | ❌ **无 API，恒可用垫底** | Grok 4.5 | Grok 4.5 |

## 三、Golden Path（工厂 F1：活被派给最优执行体）

```
Step 1: 任务到派发点 → 分配器读档位需求（task_type 查档位表：判官类=旗舰/普通=工作档）
Step 2: 枚举三家 × N 账号 → 查实时余额（Claude/Codex 有 API 按水位；Grok 无 API 恒可用）
Step 3: 三级排序选出 {vendor, account, machine, model_tier}
Step 4: 派发（本机直派 / 西安走 triggerCodexBridge）→ 记录选择依据到 payload.allocation（可审计）
Step 4-失败: 选中执行体挂了（auth/额度/不可达）→ 标记该账号不可用 → 重选次优（同档位其他家）
Step 5: 三家同档位全不可用 → Grok 垫底；Grok 也挂 → 任务留 queued + 告警（不静默丢）
```

## 四、选择策略（三级排序，定稿）

```
① 档位过滤：判官类任务只在"能提供该旗舰档"的 vendor 里选（Claude/Codex/Grok 都能提供旗舰，
   所以判官活三家都是候选；普通任务用工作档，同样三家候选）
② 余额水位排序：有 API 的两家（Claude 5h 剩余 / Codex 5h 剩余）按剩余额度降序；
   Grok 无水位数据 → 作【同档位垫底候选】，仅当有 API 的两家都封顶/认证失败/不可达时才选它
③ 平手规则：余额水位相近（差值 <10%）时，本机 us-m4 优先于西安 M4（省 ssh bridge 开销与延迟）
④ 判官护栏（决策 51b9b095）：判官类任务额度紧张时，宁可留 queued 排队等旗舰额度恢复，
   不降级用工作档——判官质量优先，裁决错误的返工成本高于等待成本
```

## 五、模块设计

**新增 `packages/brain/src/tri-axis-allocator.js`**（纯决策，无副作用，可单测）：

```js
// 档位表（决策 51b9b095，判官类用旗舰）
export const MODEL_TIERS = {
  judge: { claude: 'opus-4.8', codex: 'gpt-5.6-sol', grok: 'grok-4.5' },
  work:  { claude: 'sonnet',   codex: 'gpt-5.6-terra', grok: 'grok-4.5' },
};
// 判官类 task_type（消费方：排序官/裁决/架构审查）
export const JUDGE_TASK_TYPES = new Set([
  'triage_officer', 'architecture_design', 'arch_review',
  'harness_contract_review', 'code_review_gate', 'decomp_check',
]);

// 主决策函数（纯函数，注入 balance 快照便于单测）
export function allocate(task, balanceSnapshot) {
  const tier = JUDGE_TASK_TYPES.has(task.task_type) ? 'judge' : 'work';
  const candidates = buildCandidates(balanceSnapshot, tier);  // 三家×账号
  const ranked = rankCandidates(candidates, tier);            // 三级排序
  if (ranked.length === 0) return { deferred: true, reason: 'no_capacity', tier };
  const chosen = ranked[0];
  return {
    vendor: chosen.vendor, account: chosen.account,
    machine: machineFor(chosen),        // 账号→机器（本机/西安）
    model_tier: MODEL_TIERS[tier][chosen.vendor],
    reason: chosen.reason,              // 可审计：为何选它
    fallbacks: ranked.slice(1, 3),      // 次优候选，供失败降级
  };
}

// 账号→机器映射（机器轴）
export function machineFor(candidate) {
  if (candidate.vendor === 'codex' && candidate.remote) return 'xian_m4';  // 西安 3 账号
  return 'us_m4';  // Claude×2 / Codex×2 / Grok×1 本机
}
```

**余额快照采集 `buildBalanceSnapshot()`**（有副作用，包在决策外）：
- Claude：复用 `account-usage.js` 的 `isSpendingCapped`/`isAuthFailed`/`getSpendingCapStatus`
- Codex：复用 `executor.js pickLocalAccountByDeficit`（已按 5h% 排序，含西安 3 账号的 remote 标记）
- Grok：`~/.grok/auth.json` 存在 = 可用（无 API），标 `{vendor:'grok', available: existsSync, remote:false}`

**接入点**：`dispatcher.js` 派发前调 `allocate()`，结果写 `task.payload.allocation`，executor 按 `machine` 走本机 rotation 或 `triggerCodexBridge`。**不改 executor 的派发通道，只在它前面加决策。**

## 六、Grok 接入（新，最小）

`executor.js` 加 `triggerGrok(task, account)`：照 `dispatch-worker.mjs:37` 的命令形态——
`~/.grok/bin/grok -p '<任务书>' --cwd <dir> --always-approve`，无额度 gate（恒可用）。

## 七、测试策略（四档）

- **unit（主体，mock balance 快照）**：`tri-axis-allocator.test.js`
  - 判官任务 → 三家旗舰候选，选余额最高
  - 普通任务 → 工作档
  - Claude/Codex 都封顶 → Grok 垫底被选中
  - 三家全不可用 → `{deferred:true}` 不静默
  - 平手 → 本机优先西安
  - 判官额度紧张 → deferred 排队而非降档（护栏 51b9b095）
  - 机器轴：西安 codex 账号 → machine=xian_m4
- **integration**：`allocate()` 喂真实 `buildBalanceSnapshot()`（活额度）→ 断言返回结构完整、machine 合法
- **manual [BEHAVIOR]**：`node -e` 调 allocate 断言判官任务返回 model_tier ∈ 旗舰集
- **proven-to-fire 守卫**：故意把 Claude+Codex 全标 capped → 断言必选 Grok（垫底路径见红过）

## 八、验收（对任务 600295fe）

- [ ] [BEHAVIOR] 判官类任务分配到旗舰档（Opus4.8/GPT-5.6 Sol/Grok4.5 之一），普通任务工作档
- [ ] [BEHAVIOR] Claude/Codex 全封顶 → Grok 垫底被选（proven-to-fire）
- [ ] [BEHAVIOR] 三家全不可用 → deferred 不静默丢
- [ ] [BEHAVIOR] 西安 codex 账号 → machine=xian_m4（机器轴）
- [ ] 复用现有通道零回归（rotation/bridge 不改）；dispatcher 接入
- [ ] CI 全绿 + 版本 bump

## 九、不包含

- 不改西安 bridge / Claude rotation 通道本身（只在前面加决策层）
- 不做 Grok 额度查询（官方无 API，恒可用垫底是设计选择）
- 机器轴不做"任务→最优机器"的负载均衡（本刀只做"账号→其所在机器"的直接映射）
- 排序官消费本分配器 = 另一任务（8f7cda55），本刀只提供 allocate() 供其调用
