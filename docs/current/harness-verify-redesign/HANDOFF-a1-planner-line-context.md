# HANDOFF — A1：harness-planner 加载整条 line 的 invariant + 累积 FR（2026-07-02）

> 新会话从这里接手。全部上下文自包含，不需要翻旧对话。
> 说"看 docs/current/harness-verify-redesign/HANDOFF-a1-planner-line-context.md 接着做"即可无缝开工。

## 0. 一句话

给 harness-planner SKILL 加 **Step 0.4「加载整条 line 的历史约束」**：每个 sprint 用刚补好的两个 Brain 端点拉本 line 的**累积 FR（golden_path）+ invariant（铁律）**，注入 sprint-prd.md 两个新段落，让 GAN 对抗每次都带着整条线的历史——从源头堵"一会儿好一会儿坏"。

**这是 skill 改动，不是代码改动**：SSOT 在 `~/perfect21/zenithjoy-skills/harness-planner/SKILL.md`（v8.11+），走 **skill-creator → PR** 流程，**不走 /dev、不打 [CONFIG]、不 bump engine 版本**（memory `skills-architecture` 铁律）。cecelia 仓库里 `packages/workflows/skills/harness-planner/` 那份是 v8.8.0 过时镜像，**别改错地方**。

## 1. 前情：地基已全部就绪（2026-07-02 当天完成）

| 已完成 | PR | 给 A1 提供什么 |
|---|---|---|
| dispatcher 死锁修复（fabf6bd6） | #3502 | headless harness 派发解锁（A1 验证可用 headless 跑真 sprint） |
| **P0 端点**（A1 硬前置） | #3504 | 下面 Step 0.4 要 curl 的两个端点 |
| **A3 promotion 冻结登记** | #3507 | A1 读的数据的**写入侧**：每次 evaluator PASS 自动写 golden_path 表 + regression-contract.yaml |
| HANDOFF 同步 ×3 | #3503/#3505/#3508 | `HANDOFF.md` 第 5 节是总进度 |

## 2. A1 要用的数据源（全部已验证可用）

```bash
# ① 累积 FR：按 line 聚合已验收 ability 的 golden_path（PR #3504 新端点）
curl -s "localhost:5221/api/brain/journeys/<journey_id>/golden-paths?status=done"
# 返回 [{ability_id, ability_name, ability_status, owner_task_id, steps:[{order_no, note, ...}]}]
# ⚠️ golden_path 表当前为空（0 行）——数据由 A3 在首次 harness PASS 后写入，属预期中间态

# ② area 级 invariant（7 条系统铁律，实测可返回）
curl -s "localhost:5221/api/brain/invariants?level=area"

# ③ journey_feature 级 invariant（5 条 Line04 铁律所在层）
curl -s "localhost:5221/api/brain/invariants?target_type=journey_feature&target_id=<ability_id>"
# （也可用旧端点 GET /abilities/:id/decisions，等价）

# ④ step 级（golden_path 步上挂的决策，现有端点）
curl -s "localhost:5221/api/brain/tasks/<task_id>/golden-path-decisions?category=invariant"
```

**绝对禁止**照抄 SKILL 里 Step 0.3 现有的 `GET /api/brain/decisions?category=nfr` 写法——那个端点读的是 `decision_log` 审计表（9.5 万行）且完全忽略 category 参数（status.js:270 / shared.js:19），是个假通的门。**顺手修 Step 0.3**：把它的查询换成 `GET /invariants`（category 换 nfr 时用 `golden-path-decisions?category=nfr`）——注意 `/invariants` 端点硬编码 `category='invariant'`，NFR 要走 ④ 的端点或视需要给 `/invariants` 端点做小扩展（那是 /dev 路径的 brain 小改，别混进 skill PR）。

## 3. 具体改法（方案文档 + 已拍板修正）

详细设计：`docs/current/harness-verify-redesign/A1-planner-load-line-context.md`。要点：

1. **改哪**：`~/perfect21/zenithjoy-skills/harness-planner/SKILL.md`，在 `### Step 0.3: 读取 NFR 决策` 之后、`### Step 0.5: 推断 journey_type` 之前插入 `### Step 0.4: 加载整条 line 的 invariant + 累积 FR`。
2. **三段读取**（用第 2 节的 ①③④ 端点）+ **注入 sprint-prd.md 两个新段**（在 `## E2E 验收` 之前）：
   - `## Invariant 约束（铁律，proposer/evaluator 不得违反）` — 每行 `[标签] 铁律文字（来源: <id>）`，**此格式是 E1 的解析契约**（E1 未来把它喂给 GAN reviewer 第 8 维），别自由发挥
   - `## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）` — 按 ability 分组、order_no 排序的摘要（**只列标题行+关键步骤，设条数上限**，防 line 变长撑爆 proposer context）
   - 无数据时写"（本 line 暂无历史）"占位，**空数组也继续**（对齐 Step 0.3 纪律，全部 curl 用 `-sf ... || echo '[]'` 兜底）
3. **journey_id 缺失兜底**：`TASK_PAYLOAD.journey_id` 为空（非路径 C 点火）→ 优雅降级为"仅本 ability 级 + step 级"，不报错。
4. **铁律优先级**：invariant 不可被 PrepPRD 覆盖（只增不减）；累积 FR 与 NFR 仍"PrepPRD 显式值优先"。
5. **版本**：bump minor（如 v8.12.0），changelog 写"新增 Step 0.4 + 修 Step 0.3 坏查询"。
6. **镜像同步**：改完 SSOT 后确认 headless 运行时解析的是哪份（`~/.claude/skills/` 应是 symlink → SSOT）；cecelia 里的过时镜像看情况同步或明确标注 deprecated。

## 4. DoD（方案文档 §DoD，6 条，重点是第 5 条）

1-4 是 SKILL 文本断言（grep Step 0.4 / Invariant 段 / 累积 FR 段 / 用了正确端点没照抄坏门）——好过。
**DoD 5 是核心行为断言**：对有历史的 line 真跑一次 planner，产出的 sprint-prd.md 里 `## Invariant 约束` 段实际含 ≥1 条已知铁律文字。
⚠️ **时序注意**：golden_path 表当前为空，"累积 FR"段的端到端真验要等**首个 harness PASS**（A3 会写入数据）；但 **invariant 段现在就能真验**（area 7 条 + Line04 journey_feature 5 条都在库）。DoD 5 用 invariant 段验收即可先交付，累积 FR 段留占位符路径验证（"（本 line 暂无历史）"分支）。

## 5. 流程与环境（踩坑清单，直接抄）

- **skill 改动流程**：skill-creator skill → 改 `~/perfect21/zenithjoy-skills/` → eval → PR 到 `perfectuser21/zenithjoy-skills` repo → merge。**不是 /dev**，不建 cecelia worktree。skill 五步见 memory `feedback_skill_creation_flow`（创建→eval→Brain DB→Notion→PR，eval 在 PR 前）。
- 本机 Brain 探活：`curl -s --max-time 3 localhost:5221/api/brain/context`，000 → `docker compose -f /Users/administrator/perfect21/cecelia/docker-compose.yml up -d node-brain`。
- **本机 Brain 容器跑旧镜像**：PR #3504/#3507 的新端点/新模块要 `brain-deploy.sh` 重建镜像后才在 localhost:5221 生效（memory `feedback_brain_pull_before_reload`）。验证端点时若 404 先想到这个——可临时用 scratch express 挂 router 验（今天 P0 就是这么本机验的，见 #3504 PR body）。
- Cecelia harness journey_id = `bb8cc561-b3ee-4fec-b74d-2255694bd963`；Line04 相关铁律 target 的 ability id 用 `curl -s "localhost:5221/api/brain/invariants" | jq '[.[] | select(.topic | contains("Line04"))] | .[].target_id'` 查。
- PR 合并后照例 engine-pr-watchdog 阻塞轮询；zenithjoy-skills repo 的 CI 约定可能与 cecelia 不同，开 PR 前看一眼该 repo 近期 merged PR 的格式。

## 6. A1 之后的路（HANDOFF.md 第 5 节）

真机簇 **D1**（客户机 agent checks.py 一份两用，zenithjoy 跨仓）→ **C1**（tests/rog + session-1 runner 发版闸）→ **A2**（generator Step 6.5 连 rog 真跑，治"炸"）→ **E1**（GAN reviewer 第 8 维 invariant_compliance，消费 A1 注入的 Invariant 段格式）。

## 7. 完成标志

- [ ] SSOT SKILL.md 含 `### Step 0.4`（含三段读取 + 注入模板 + 降级兜底），Step 0.3 坏查询已修
- [ ] 版本 bump + changelog
- [ ] DoD 1-4 文本断言过；DoD 5 用 invariant 段真验（跑一次 planner 或最小复现：手动按 Step 0.4 命令拼 sprint-prd 段落确认铁律文字进来）
- [ ] PR 合并到 zenithjoy-skills
- [ ] `docs/current/harness-verify-redesign/HANDOFF.md` 第 5 节标记 A1 完成（cecelia repo，独立 docs 分支）
- [ ] 若给 `/invariants` 端点做了 NFR 小扩展 → 那部分单独走 cecelia /dev PR，别混进 skill PR
