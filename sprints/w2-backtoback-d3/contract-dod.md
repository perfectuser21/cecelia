# Contract DoD — 背靠背服务端裁剪 + 三 token 分权（D3）

task_id: 0b7df1ca-da50-4928-9d24-bfbb8ae7cd90
sprint_dir: sprints/w2-backtoback-d3

---

## DoD 总览

| 项 | 检查方式 | 必须通过 |
|----|---------|---------|
| D1: failing tests 先入库 | `git log` 确认测试 commit 早于修复 commit | ✓ |
| D2: 测试全绿（≥14 断言） | `npx vitest run packages/brain/src/__tests__/acceptance-d3-backtoback.test.js` | ✓ |
| D3: AI 四列默认隐藏 | curl 验收 + psql 确认 | ✓ |
| D4: view=review 403 | curl 验收 | ✓ |
| D5: 三 token 分权不崩 | 单元测试 B7~B11 | ✓ |
| D6: 写侧过滤 | 单元测试 B13 + psql | ✓ |
| D7: 公网端点函数体保留 | `grep -n "submitAcceptanceResults" acceptance-public-server.js` | ✓ |
| D8: CI 覆盖（brain-ci.yml）| PR diff 含测试文件 + island-gate 绿 | ✓ |
| D9: 上线前核日志 SOP | 见下方 SOP 条目 | ✓ |
| D10: 无 `console.log` 遗留 | code review | ✓ |

---

## 测试 DoD（FR-8 映射）

测试文件：`packages/brain/src/__tests__/acceptance-d3-backtoback.test.js`

### 必须覆盖的 9 条读侧出口

| 编号 | 出口 | 断言内容 |
|------|------|---------|
| R1 | `GET /runs?gp_id=xxx` 默认 | checks 无 AI 四列 |
| R2 | `GET /runs?gp_id=xxx` 有活跃 run（gp 级跨轮闸） | AI 四列 + adjudication 置空 |
| R3 | `GET /runs/:run_key` 默认 | checks 无 AI 四列 |
| R4 | `GET /runs/:run_key?view=review` + status=human_complete | checks 含 AI 四列（值可 null） |
| R5 | `GET /runs/:run_key?view=review` + status=pending | HTTP 403 |
| R6 | `GET /runs/:run_key?view=review` + status=in_review | HTTP 403 |
| R7 | 内网 `GET /pending` | runs checks 无 AI 四列 |
| R8 | `loadRunsWithChecks` SQL 使用显式列（不含 AI 四列） | SQL 字符串断言 |
| R9 | `loadChecks` SQL 使用显式列（不含 AI 四列） | SQL 字符串断言 |

### 必须覆盖的 2 组反向断言

| 编号 | 场景 | 反向断言 |
|------|------|---------|
| A1 | 默认读取路径 | `ai_verdict` 字段不存在 OR 为 null（不能为任何字符串值） |
| A2 | view=review + 非 human_complete | 响应不含 checks 内容（403 before data） |

### 必须覆盖的 3 条写侧断言

| 编号 | 场景 | 断言 |
|------|------|------|
| W1 | `POST /acceptance/ai-results` 含 result 字段 | DB 中 `result` 列不变 |
| W2 | `POST /acceptance/ai-results` 含 submitted_by 字段 | DB 中 `submitted_by` 列不变 |
| W3 | `POST /acceptance/ai-results` 含 adjudication 字段 | DB 中 `adjudication` 列不变（或为 null） |

**最低断言总数：≥ 14**

---

## DoD SOP 条目

### SOP-1：上线前核日志（[上线前核日志] 铁律）

```bash
# 在 hk-vps 执行（5223 日志）
# 核查 POST /acceptance/results 与 GET /acceptance/pending 近 30 天调用方
# 若发现非预期活跃调用方：改走候选 B 并回报，不得跳过
ssh hk-vps "grep 'acceptance/results\|acceptance/pending' /var/log/nginx/access.log | awk '{print \$1,\$7,\$12}' | sort | tail -n 200"
```

- 若无活跃调用方 → 可继续解挂路由
- 若发现活跃调用方 → 停止，报告用户，等待决策

### SOP-2：failing test 先 commit 确认

```bash
# 确认测试 commit 早于修复 commit
git log --oneline packages/brain/src/__tests__/acceptance-d3-backtoback.test.js | head -3
# 第一条 commit 应早于修改 acceptance.js / acceptance-public-server.js 的 commit
```

### SOP-3：CI 覆盖验证（FR-9）

```bash
# 确认 acceptance-d3-backtoback.test.js 被 changed-test-router 或 vitest glob 覆盖
# 方式一：检查 vitest 配置 glob 是否包含 __tests__/*.test.js
grep -n "include\|testMatch\|glob" /workspace/packages/brain/vitest.config.*
# 方式二：确认 PR diff 含新测试文件，island-gate 不报孤岛
```

### SOP-4：公网函数体保留验证（NFR-5）

```bash
# 修改后验证：函数体存在但路由未挂载
grep -n "submitAcceptanceResults\|createAcceptancePublicRouter\|acceptance/results" \
  /workspace/packages/brain/src/acceptance-public-server.js
# 期望：含 submitAcceptanceResults（函数引用/import），不含 app.use('/acceptance/results'...)
```

---

## 累积 FR 回归防护

以下 D1 已验收行为，本 sprint 修改不得破坏：

| 条目 | 验证命令 |
|------|---------|
| acceptance_checks.ai_verdict CHECK 约束 | migration 392 在 CI 全量 migration 中跑 |
| 7 值状态机 CHECK | migration 392 |
| UNIQUE (run_id, check_key) | migration 392 |
| POST /acceptance/ai-results reason=scenario_not_triggered → 400 | `acceptance-ai-reason.test.js` |
| computeRunStatus 调用路径 | `acceptance-run-status.test.js` |

---

## 产物清单

- `sprints/w2-backtoback-d3/contract-draft.md` ✓
- `sprints/w2-backtoback-d3/contract-dod.md` ✓（本文件）
- `sprints/w2-backtoback-d3/tests/acceptance-d3-backtoback.test.js` ✓
