# Sprint PRD — relay-runs PATCH 短号防呆

## OKR 对齐

- **对应 KR**：Brain 收账链路可靠性（relay run 回写零静默失败）
- **当前进度**：07-14 第 3 发实证：短号 PATCH 全程失败，run 停在 A_planning，pr_url 空，evaluator done 事件缺失，靠人工两笔补录收口
- **本次推进预期**：PATCH /orchestrator/relay-runs/:id 支持 8 位十六进制短号，解析失败返回 400/404 带上下文，DB 错误 console.warn 留痕

## 背景

controller session 以短号（如 `dd34e184`，initiative_id 的前 8 位十六进制）调 PATCH 回写 phase/pr_url，路由层直接把短号当 uuid 传 pg，报 `invalid input syntax for type uuid: "dd34e184"`，被 catch 吞成 500 静默失败。三次实证均无告警，run 全停在中间态，靠人工补录才收口。

## Golden Path（核心场景）

controller session 从 [PATCH /orchestrator/relay-runs/dd34e184 传 phase=done] → 经过 [路由层短号解析为唯一活跃 run 的 initiative_id] → 到达 [200 且 run.phase=done、pr_url 已落库]

具体：
1. PATCH 传 8 位十六进制短号 `dd34e184`，库中存在唯一 orchestrator_version=v2 且 phase 非终态的 run，initiative_id 以该短号为前缀
2. 路由层识别为短号（非 UUID 格式），查 initiative_runs 找唯一匹配行
3. 更新成功，返回 200 + 更新后对象
4. 命中多条时取 started_at 最新且 phase 非终态（done/failed 排除）的一条
5. 命中 0 条返回 404，error 文案含短号原值
6. 完整 UUID 参数走既有逻辑，行为不回退

## 边界情况

- 短号命中多条非终态 run → 取 started_at DESC LIMIT 1（最新）
- 短号命中 0 条 → 404 + `{ error: 'run not found for short id: dd34e184' }`
- 参数既非完整 UUID 也非 8 位十六进制 → 400 + `{ error: 'invalid id format' }`
- DB 查询抛异常 → console.warn 带 initiative_id/短号上下文，返回 500

## 范围限定

**在范围内**：
- `packages/brain/src/routes/initiatives.js`：`router.patch('/relay-runs/:initiative_id', ...)` 入口增加短号解析层
- `packages/brain/src/__tests__/relay-runs-patch-shortid.test.js`：failing test 先 commit（4 个场景）

**不在范围内**：
- relay-runs 字段语义、鉴权、允许的 phase 白名单（不改）
- skill 文本（防呆必须在代码侧）
- GET /relay-runs/:initiative_id 路由（不动）
- 其他路由（POST、GET list）

## 假设

- [ASSUMPTION: 短号定义为 8 位十六进制字符串（/^[0-9a-f]{8}$/i），initiative_id::text 以此前缀开头]
- [ASSUMPTION: 多命中时"非终态"定义为 phase NOT IN ('done', 'failed')]
- [ASSUMPTION: orchestrator_version='v2' 过滤条件保留（既有铁律，不放宽）]

## 预期受影响文件

- `packages/brain/src/routes/initiatives.js`：PATCH handler 首部加短号识别 + 解析逻辑（统一入口，不散落）
- `packages/brain/src/__tests__/relay-runs-patch-shortid.test.js`：新建 failing test（4 场景），先于修复 commit

## NFR

- 短号解析额外 DB 查询 < 10ms（indexed prefix scan）
- DB error 必须 console.warn 带 initiative_id/短号，不静默
- 不改现有 relay-runs 路由的鉴权与字段语义

## Invariant 约束

<!-- 三源铁律：decisions 表、area 规则、PrepPRD 明文 -->
- [PrepPRD 铁律] 不改 relay-runs 的字段语义与鉴权；只做 id 解析与错误处理
- [PrepPRD 铁律] 短号解析在路由层统一做，不散落 handler 内
- [PrepPRD 铁律] 回写失败（DB error）console.warn 带 initiative/run 上下文，不静默
- [area 规则] failing test 必须先于实现 commit 到 repo，永久留在 CI 跑（regression test）
- [area 规则] 凭据安全：secrets 不硬编码、不进 git、不进日志
- [area 规则] 真环境验证：接缝断言必须在真目标上验证过才算 done

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: relay-runs 已完成 ability 的 golden_path -->
- PATCH /relay-runs/:id 接受 phase ∈ {planning, gan, generate, evaluate, done, failed}（白名单，bogus→400）
- phase=done/failed 时写 completed_at；中间态不写
- failure_reason 可选随 failed 一起落库
- pr_url 非空时须以 https://github.com/ 开头，否则 400
- verdict/evaluate_verdict/cost 非法值忽略+warn（不 400，避免打回终态写入触发 watchdog 重点火）
- 目标不存在或非 v2 → 404

## E2E 验收

> Planner 初稿此区块框定"端到端要验到什么"，可执行脚本由 proposer 在 GAN 阶段产出。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实 curl+psql 脚本
# 期望验收点（自然语言）：
# 1. 库中存在唯一活跃 v2 run（initiative_id = "dd34e184-xxxx-..."）
#    PATCH /orchestrator/relay-runs/dd34e184 phase=done → 200，psql 确认 phase=done
# 2. 库中存在两条 initiative_id 前缀相同的 v2 非终态 run
#    PATCH 短号 → 200，更新的是 started_at 最新的那条
# 3. 完整 UUID PATCH → 行为与修复前等价（200 或 404），不回退
# 4. 短号命中 0 条 → 404，error 含短号原值
```

## journey_type: local_api
## journey_type_reason: 纯 Brain API 路由逻辑，无前端 UI，单测 + curl 验收即可
## target_environment: local_api
## target_environment_reason: packages/brain 后端路由修改，本地 Brain API（localhost:5221）验收，无需浏览器
## journey_id: none
## step_id: none（PrepPRD 未锚定）
