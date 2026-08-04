# Sprint PRD：刀0.5 — 僵尸文档清尸

**Task ID**: 35cb771b-82bf-4d24-b1c4-b7a7b40af79f
**Sprint Dir**: sprints/08041713-doc-zombie-cleanup
**决策锚点**: 6020bb14（状态快照型文档物种永久取缔）

---

## 一、范围确认（基于仓库考古）

### 1.1 退役目标文件（已核实存在）

| 文件 | 现状 | 处置 |
|------|------|------|
| `.agent-knowledge/skills-index.md` | 存在 | `git mv` → `docs/archive/agent-knowledge-retired/` |
| `.agent-knowledge/CURRENT_STATE.md` | 存在 | `git mv` → `docs/archive/agent-knowledge-retired/` |
| `scripts/write-current-state.sh` | 存在 | `git mv` → `docs/archive/agent-knowledge-retired/` |
| `scripts/__tests__/write-current-state.test.sh` | 存在 | `git mv` → `docs/archive/agent-knowledge-retired/` |

### 1.2 连带引用点（write-current-state 全仓扫描结果）

**CI 工作流（须改）**：
- `.github/workflows/ci.yml` 第 454-455 行：`test-pyramid-guard` job 中 `write-current-state 自测` step → 删除该 step
- `.github/workflows/nightly-regression.yml` 第 335-336 行：同名 step → 删除

**测试文件（须处置）**：
- `packages/engine/tests/write-current-state.test.ts` — 测试已退役脚本，整体退役到 archive
- `packages/engine/tests/integration/cleanup-write-state.test.ts` — 断言 `cleanup.sh` 包含 `write-current-state.sh` 调用 → 退役（该断言将因 cleanup.sh 不再调用而失效）
- `packages/engine/tests/integration/current-state-format.test.ts` — 运行已退役脚本 → 退役

**cleanup.sh（须改）**：
- `packages/engine/skills/dev/scripts/cleanup.sh` 第 295-304 行：删除 `write-current-state.sh` 调用段（Section 2.6），因退役后脚本不存在

**docs（存档类，不改，只在 archive 区归档）**：
- `docs/designs/current-state-auto-update.md` — 设计文档，保留引用（历史记录）
- `docs/instruction-book/features/write-current-state.md` — 使用手册，保留（历史记录，在 archive 类目下）
- `sprints/*/prep-prd.md` — 历史 sprint 文档，保留
- `docs/superpowers/plans/` 下历史计划文档 — 保留

**Brain 源码（须注释/修改说明）**：
- `packages/brain/src/seven-ring-audit.js` 第 32 行：`write-current-state.sh` 引用 → 改为注释说明已退役
- `packages/brain/src/routes/quality.js` 第 6 行：数据源注释 → 更新为说明已退役

**feature-registry.yml**：
- `packages/engine/feature-registry.yml` 第 1198 行：`write-current-state.test.ts` 路径引用 → 保留（历史 changelog 记录，不改）

**docs/registry**：
- `docs/registry/features/engine.yml` 第 49、71 行：`packages/engine/tests/write-current-state.test.ts` → 删除该测试文件引用

### 1.3 幻觉引用清理（docs/current/README.md）

已核实 PATROL-REGISTRY 引用位置（第 34、49、55 行）：
- 第 34 行：表格中「自动巡检状态」行 → 整行删除
- 第 49 行：决策表中 `PATROL-REGISTRY.md 更新状态` → 整行删除
- 第 55 行起：`## 自动巡检状态（PATROL-REGISTRY）` 整节 → 删除

CI_PIPELINE.md、DEV_PIPELINE.md 两行（第 32-33 行）：
- 说明改为「⚠️ 过期待重写（2026-03旧结构），仅存档参考」

### 1.4 engine.md 死路径修正

三处死路径（真身已核实在 `packages/quality/scripts/devgate/`）：

| 错误引用 | 真实路径 |
|---------|---------|
| `node packages/engine/scripts/devgate/check-dod-mapping.cjs` | `node packages/quality/scripts/devgate/check-dod-mapping.cjs` |
| `node scripts/devgate/scan-rci-coverage.cjs` | `node packages/quality/scripts/devgate/scan-rci-coverage.cjs` |
| `bash scripts/devgate/require-rci-update-if-p0p1.sh` | `bash packages/quality/scripts/devgate/require-rci-update-if-p0p1.sh` |

DevGate 表格中 `scripts/devgate/` 路径描述（第 24 行）也需修正为 `packages/quality/scripts/devgate/`（+ `packages/engine/scripts/devgate/`）

### 1.5 AGENTS.md 去快照化

**删除**：
- 第 86-97 行：`## 深度知识（HTML 知识页）` 整节（含 `http://38.23.47.81:9998` URL）
- 第 101 行：`*最后更新：2026-03-16 | Brain v1.217.0 | 63 Skills*` 整行
- 第 102 行：`*自动维护：skills-index.md 由 CI 脚本从 SKILL.md 提取生成*` 整行（引用已退役文件）

**数字引用去快照化**：
- 第 18 行（`## Cecelia 是什么` 代码块内）：`+ 63 个 Skills（外部能力库）` → `+ Skills 外部能力库（数量见 Brain API /api/brain/skills/count）`
- 第 51 行（模块地图表）：`63 个外部能力` → `外部能力` + 删除 `→ [skills-index.md](.agent-knowledge/skills-index.md)` 链接（已退役）
- 第 57-58 行（`## Cecelia 能调用什么`）：删除整节（两行全指向已退役文件）

**修正死路径**：
- 第 80 行：`不要跳过 DevGate（\`scripts/devgate/\`）` → 改为 `packages/quality/scripts/devgate/` 与 `packages/engine/scripts/devgate/`

**保留不动**：
- `KERNEL_HARNESS_MAP` 指针行（第 48 行，已存在，不重复）
- `<!-- HARD_RULES:BEGIN -->` 到 `<!-- HARD_RULES:END -->` 区块（第 109-154 行，禁碰）

---

## 二、Regression Test 计划（TDD 先红后绿）

### 测试文件位置
`packages/engine/tests/integrity/doc-zombie-retired.test.sh`

（该目录已有 `auto-merge-token-contract.test.sh` 等，glob 自动接线）

### 五条断言

```bash
# 断言 1：.agent-knowledge/ 下不存在退役文件
assert_not_exists ".agent-knowledge/skills-index.md"
assert_not_exists ".agent-knowledge/CURRENT_STATE.md"

# 断言 2：.claude/CLAUDE.md 不含退役 @import 行
assert_not_contains ".claude/CLAUDE.md" "@.agent-knowledge/skills-index.md"
assert_not_contains ".claude/CLAUDE.md" "@.agent-knowledge/CURRENT_STATE.md"

# 断言 3：docs/current/README.md 不含 PATROL-REGISTRY 字样
assert_not_contains "docs/current/README.md" "PATROL-REGISTRY"

# 断言 4：全仓（排除 docs/archive/ 与本测试自身）无 write-current-state 引用
# 使用 grep -r --exclude-dir=docs/archive --exclude=doc-zombie-retired.test.sh
assert_no_grep_match "write-current-state" "排除 docs/archive 与本测试"

# 断言 5：AGENTS.md 不含已取缔内容
assert_not_contains "AGENTS.md" "38.23.47.81:9998"
assert_not_contains "AGENTS.md" "最后更新：2026-03-16"
```

### 执行计划
- **commit-1（测试先红）**：仅新建测试文件，不做任何实质变更，跑测试确认 5 条全红
- **commit-2（实施变绿）**：执行全部变更，跑测试确认 5 条全绿

---

## 三、实施步骤（顺序）

### Step 1：新建测试文件（commit-1）
创建 `packages/engine/tests/integrity/doc-zombie-retired.test.sh`，5 条断言全红

### Step 2：退役文件 git mv（commit-2 的一部分）
```bash
mkdir -p docs/archive/agent-knowledge-retired
git mv .agent-knowledge/skills-index.md docs/archive/agent-knowledge-retired/
git mv .agent-knowledge/CURRENT_STATE.md docs/archive/agent-knowledge-retired/
git mv scripts/write-current-state.sh docs/archive/agent-knowledge-retired/
git mv scripts/__tests__/write-current-state.test.sh docs/archive/agent-knowledge-retired/
```

退役关联测试：
```bash
mkdir -p docs/archive/engine-tests-retired
git mv packages/engine/tests/write-current-state.test.ts docs/archive/engine-tests-retired/
git mv packages/engine/tests/integration/cleanup-write-state.test.ts docs/archive/engine-tests-retired/
git mv packages/engine/tests/integration/current-state-format.test.ts docs/archive/engine-tests-retired/
```

### Step 3：修改 .claude/CLAUDE.md
删除第 6-7 行的两个 @import：
- `@.agent-knowledge/skills-index.md`
- `@.agent-knowledge/CURRENT_STATE.md`

### Step 4：修改 .github/workflows/ci.yml
删除 `test-pyramid-guard` job 中：
```yaml
      - name: write-current-state 自测（原孤儿测试接入）
        run: bash scripts/__tests__/write-current-state.test.sh
```

### Step 5：修改 .github/workflows/nightly-regression.yml
删除同名 step（第 335-336 行）

### Step 6：修改 packages/engine/skills/dev/scripts/cleanup.sh
删除 Section 2.6 的 `write-current-state.sh` 调用段（约第 291-305 行）

### Step 7：修改 docs/current/README.md
- 删除 3 处 PATROL-REGISTRY 引用（第 34、49、55行及该节内容）
- CI_PIPELINE.md、DEV_PIPELINE.md 说明改为「⚠️ 过期待重写（2026-03旧结构），仅存档参考」

### Step 8：修改 .agent-knowledge/engine.md
修正三处死路径（`scripts/devgate/` → `packages/quality/scripts/devgate/`）

### Step 9：修改 AGENTS.md
- 删除「深度知识（HTML 知识页）」整节
- 删除快照行（`最后更新`、`自动维护`）
- 去数字化（63 个 Skills → 无数字表述）
- 删除已退役文件链接
- 修正 DevGate 路径引用
- **禁碰** HARD_RULES:BEGIN/END 区块

### Step 10：修改 packages/brain/src/seven-ring-audit.js
第 32 行 `write-current-state.sh` 引用 → 更新注释说明数据源已退役，改为 Brain API 直接查询

### Step 11：修改 packages/brain/src/routes/quality.js
第 6 行数据源注释 → 更新说明已退役

### Step 12：修改 docs/registry/features/engine.yml
删除 `write-current-state.test.ts` 测试文件路径引用

---

## 四、验收标准（Final E2E）

- [ ] `packages/engine/tests/integrity/doc-zombie-retired.test.sh` 5 条断言全绿
- [ ] commit-1（测试红）在前，commit-2（实施绿）在后
- [ ] CI 全绿：`测试金字塔守卫` job 不含 write-current-state step 且不报错
- [ ] CI 全绿：`三方对账闸` job 绿（HARD_RULES 未被碰）
- [ ] `grep -r write-current-state --exclude-dir=docs/archive .` 零命中（archive 外无引用）
- [ ] `grep -r "PATROL-REGISTRY" docs/current/README.md` 零命中

---

## 五、禁止事项（不扩 scope）

- 不动 25 个孤儿目录归并
- 不动 Notion 链路、sprints/ 归档策略
- 不重写 CI_PIPELINE/DEV_PIPELINE 内容（只标过期）
- 不碰 Kernel/orchestrator 代码
- 不碰 HARD_RULES:BEGIN/END 区块

---

## 六、风险与注意事项

1. **cleanup-write-state.test.ts 的 cleanup.sh 断言**：该测试断言 `cleanup.sh` 包含 `write-current-state.sh` 调用，退役 cleanup.sh 中该调用后此测试必然失败——需同步退役此测试到 archive（已列入 Step 2）

2. **nightly-regression.yml**：第 335-336 行有相同的 `write-current-state 自测` step，必须一并删除（否则 nightly CI 红）

3. **seven-ring-audit.js**：第 32 行 `write-current-state.sh` 注释是 Brain 功能说明，不是调用——改为说明已退役即可，不影响运行时逻辑

4. **AGENTS.md 的 skills-index.md 链接**：模块地图表和「Cecelia 能调用什么」节均指向已退役文件，两处都需清理

---

## Invariant 约束

（从 Brain `GET /api/brain/invariants?line=cecelia` 加载，共 105 条，以下为分类摘要）

**Harness / Pipeline 类**：
1. watchdog 对「从未启动的进程」必须走 never_started 分类兜底且不覆盖已有 error_message/failure_class
2. relay 单 session 模式必须在各 phase 完成时调 POST /api/brain/harness/phase-event 写 node 级 done 事件
3. PR 处于 CONFLICTING 状态时 GitHub 静默不触发 pull_request CI：不要按 CI 卡死空等，先 merge
4. evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名
5. headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reap
6. harness judge 未按 target_environment 校准证据要求
7. PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR label/状态机补判

**测试 / CI 类**：
8. 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push
9. Red commit 必须只 git add 精确路径（*.test.ts），禁止 git add . 或 git add .harness
10. 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动

**数据 / DB 类**：
11. capture_atoms urgent 路由建任务前必须按锚点/探针坐标查重：同根因已有 open 任务时合并而非裂变新单
12. 守卫/探针自产数据用共享常量前缀（如 LEDGER_SELF_ATOM_PREFIX）标记并在统计侧排除，防自指计数污染
13. 探针类时间窗口用确定性日历窗口（自然日+时区）而非 NOW()-interval 滑动窗，防执行时刻秒级漂移重复计账/漏计
14. 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑

**系统通则类**：
15. [系统] 禁止写死环境假设值
16. [系统] 真环境验证才算 done
17. [系统] 测试默认多租户
18. [系统] 凭据安全
19. [系统] 日志脱敏
20. [系统] 端点鉴权
21. [系统] 租户隔离

（完整 105 条见 Brain decisions 表 category=invariant）

---

## 累积 FR

（从 Brain `GET /api/brain/features?line=cecelia` 加载，共 247 条 active features，以下为核心功能列表节选）

| ID | 名称 | 领域 | 优先级 |
|----|------|------|--------|
| llm-caller | LLM 调用层 | admin/brain | P0 |
| agent-execution | Agent 执行引擎 | agent/brain | P0 |
| alerting-notifier | 飞书告警通知 | collaboration/brain | P0 |
| dashboard-live-monitor | 实时监控面板 | dashboard | P0 |
| dashboard-roadmap | OKR 路线图 | dashboard | — |
| dashboard-tasks | 任务管理界面 | dashboard | — |
| context-snapshot | Brain 上下文快照 | brain | — |
| okr-current | OKR 当前状态 | brain | — |
| brain-health | Brain 健康检查 | brain | P0 |

（完整 247 条见 Brain features 表；本刀为文档整理，不新增 FR，不改变任何 feature 状态）

---

## NFR

N/A（本刀为文档整理，无性能/可用性/安全性 NFR）

---

journey_type: feature
target_environment: local_api
