# Sprint PRD — Crystal 第3件：契约 reviewer skill（15 秒轻对抗审契约完备性）

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（Crystal 结晶线补齐"契约完备性把关"一环）

## 背景

Crystal 第2件把技能契约 schema 化为九格 CHECKS + 八格业务 postcondition，但"schema 齐全"不等于"语义完备"——缺失前置、不可判定后置、未声明失败模式仍会漏网，下游 Generator 拿到形状合法但语义有洞的契约再次撞死。本 sprint 把 09-05 实测过的轻对抗审契约提示词固化为一个独立 skill：输入一份技能契约，15 秒内单枪跑出按严重度排序的漏洞清单。实测基准：对 `search_account` 契约一枪找出 8 洞，第一条即真实死因。

注意：本 skill 与既有 `harness-contract-reviewer`（GAN 多轮 sprint 合同审查员）是**两个不同物**——后者审 sprint contract、多轮对抗；本 skill 审**技能契约本体**、单枪 15 秒轻对抗，不进 GAN 循环。

## Golden Path（核心场景）

操作者/Crystal 编排器 [输入一份技能契约] → 经过 [15 秒单枪轻对抗扫描] → 到达 [按严重度排序的 ≤8 条漏洞清单 + 判定假设洞落库]

具体：
1. 触发：调用本 reviewer skill，传入一份技能契约（第2件产出的九格 CHECKS + 八格业务 postcondition 格式）。
2. 系统处理：skill 用固化的 09-05 提示词做单枪轻对抗（≤15 秒，不多轮），沿三类缺陷面扫描：**缺失前置**（precondition 缺口）、**不可判定后置**（postcondition 无法机械判真伪）、**未声明失败模式**（failure mode 未登记）。
3. 可观测结果：输出一份漏洞清单，按严重度降序排列，最多 8 条，第一条为最严重（真实死因）。
4. 落库：清单中属**判定假设**的漏洞，按规矩写入 Brain `decisions`（category=judgment）。
5. 批量：上线后可对第2件产出的**全部契约**逐份扫描，产出各自的漏洞清单。

出口：操作者拿到排序漏洞清单；判定假设类洞已持久化为 decisions；对 `search_account` 基准契约复跑得到 8 条洞、第一条命中真实死因。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 契约本身格式非法/无法解析 → 明确报错，不产出假空清单。
- 零漏洞契约 → 返回空清单（0 条），不得为凑数编造洞。
- 漏洞数 > 8 → 只保留严重度最高的 8 条，并标注被截断。
- 判定假设洞落库失败（Brain 不可达）→ 清单仍产出，落库失败只告警不阻塞。

## 范围限定

**在范围内**：
- 固化 09-05 轻对抗审契约提示词为一个独立 skill（输入=技能契约，输出=排序漏洞清单）。
- 三类缺陷面识别：缺失前置 / 不可判定后置 / 未声明失败模式。
- 严重度排序 + ≤8 条上限。
- 判定假设洞写 decisions(category=judgment)。
- 对第2件已产出契约的批量扫描能力。

**不在范围内**：
- 不改第2件的九格 CHECKS schema 本身。
- 不并入 GAN 多轮循环（本 skill 是单枪轻对抗）。
- 不做自动修复契约（只审、只报、只登记，不改契约正文）。
- 不做 UI / dashboard 展示。

## 假设

- [ASSUMPTION: 新 skill 落在 `packages/workflows/skills/` 下的独立目录（Skills SSOT），具体 slug 由 Proposer 定，需与既有 `harness-contract-reviewer` 明确区分。]
- [ASSUMPTION: "技能契约"输入格式 = 第2件产出的九格 CHECKS + 八格业务 postcondition；`search_account` 契约作为回归基准样例。]
- [ASSUMPTION: 判定假设洞落库走 Brain `POST /api/brain/decisions`（category=judgment），字段规范由 Proposer 读 api_registry 推导。]

## 预期受影响文件

- `packages/workflows/skills/<新 reviewer skill 目录>/SKILL.md`：固化提示词的 skill 本体（新增）。
- `packages/workflows/skills/harness-contract-reviewer/`：仅需在语义上与本 skill 区分，预期不改。
- Brain `decisions`（category=judgment）：判定假设洞的落库目标（经 Brain API，非直改表）。
- 批量扫描的驱动脚本位置（scripts/ 或 Crystal 编排入口）：由 Proposer 锚定。

## NFR 约束

<!-- 来源: thin_prd 显式值优先；decisions/step-NFR 双源本 sprint 为空数组 -->
- 延迟：单份契约审查 ≤ 15 秒（thin_prd 显式"15 秒轻对抗"）。
- 输出上限：漏洞清单 ≤ 8 条，按严重度降序，第一条为最严重。
- 可观测/持久化：判定假设类漏洞必须写 Brain decisions（category=judgment）；落库失败只告警不阻塞产出。
- 版本要求：无（纯后台/skill 资产，无外部客户端版本约束）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature 两源本 sprint 为空；以下取 area 级中与本任务相关者。area 级余项多为 [capture-triage] learning 噪音，未逐条注入。 -->
- [planner分支] Planner 只用服务端签发的 PLANNER_BRANCH，禁止自行 checkout/switch（来源: area）
- [合同验证实跑] 合同里的验证命令必须实跑确认 exit code 语义，vitest 对 include 范围外路径绿态也 exit 0（来源: area）
- [judge证据窗] judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产结果文件必须把一手证据前置压缩（来源: area）
- [台账离git] controller 台账（如 .harness/progress.md）必须保持在 git 追踪之外，勿随 sprint PR 带入 repo（来源: area）
- [凭据不混用] 多人协作禁止混用授权凭据，操作他人账号资源要用其本人授权（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 无 done/working ability -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + node skill 执行 + psql/Brain API 核对）。

```bash
# 占位：proposer 按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1) 把 search_account 基准契约喂给本 reviewer skill，输出漏洞清单为按严重度排序、条数=8、第一条命中真实死因。
# 2) 清单中判定假设类漏洞可在 Brain decisions（category=judgment）查到对应新增行。
# 3) 单份契约审查耗时 ≤ 15 秒。
# 4) 喂一份零漏洞契约，输出空清单（0 条），不编造洞。
```

## journey_type: autonomous
## journey_type_reason: 交付物是纯后台 skill 资产（审技能契约 + 写 Brain decisions），无 UI、无远端 agent、非 engine hooks，落 else 默认。
## target_environment: local_api
## target_environment_reason: E2E 在本地 evaluator 跑（node 执行 skill + curl/psql localhost:5221 核对 decisions 落库），无前端/Windows/微信/远端部署。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
