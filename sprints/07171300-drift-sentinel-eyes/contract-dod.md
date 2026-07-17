# DoD（完成定义）— drift-sentinel-eyes hotfix

**TASK_ID**: fe385921-603a-449f-ba88-606559fd2d43
**Sprint Dir**: sprints/07171300-drift-sentinel-eyes
**HARNESS_GEAR**: hotfix
**日期**: 2026-07-17

---

## [BEHAVIOR] 条目

### [BEHAVIOR-T1] sha_main 容器环境 — HTTPS URL 免凭据路径

- **触发条件**: 容器内 `git ls-remote origin` 不可达，`gh` CLI 无 auth
- **期望行为**: `defaultFetchMainSha()` 改用 `git ls-remote https://github.com/perfectuser21/cecelia.git refs/heads/main`，返回 stdout 第一 token（≥7位 SHA）
- **断言**: `sha.length >= 7` AND `verdict !== 'network_error'`
- **对应 FR**: FR-1
- **测试文件**: `sprints/07171300-drift-sentinel-eyes/tests/drift-sentinel-contract.test.js` → `T1`

---

### [BEHAVIOR-T2] sha_main 二级降级 — curl GitHub API

- **触发条件**: `git ls-remote <HTTPS URL>` 失败（exit non-zero 或 stdout 空）
- **期望行为**: 降级执行 `curl -sf --max-time 10 https://api.github.com/repos/perfectuser21/cecelia/commits/main`，解析 `.sha` 字段返回
- **断言**: 返回值 === mock JSON `.sha` 字段值，NOT undefined/empty
- **对应 FR**: FR-1（降级路径）
- **测试文件**: `sprints/07171300-drift-sentinel-eyes/tests/drift-sentinel-contract.test.js` → `T2`

---

### [BEHAVIOR-T3] sha_prod 使用 localhost 自查（正确端点：/api/brain/health）

- **触发条件**: `BRAIN_PROD_URL` 未设置（默认值生效）
- **期望行为**: `defaultFetchProdSha()` 默认 URL 改为 `http://localhost:5221/api/brain`（包含 `/api/brain` 前缀），curl 拼接 `/health` 后完整路径为 `http://localhost:5221/api/brain/health`——此端点由 `routes/goals.js` 的 `/health` 路由提供，挂载在 `app.use('/api/brain', brainRoutes)` 下，返回 `git_sha` 字段
- **断言**: mock exec 中 `curl -sf --max-time 10 "http://localhost:5221/api/brain/health"` 被调用；mock 返回 `{"git_sha":"def456..."}` → 函数返回 `"def456..."` AND `verdict !== 'prod_unreachable'`
- **对应 FR**: FR-2
- **测试文件**: `sprints/07171300-drift-sentinel-eyes/tests/drift-sentinel-contract.test.js` → `T3`

---

### [BEHAVIOR-T4] 错误日志含原始错误文本

- **触发条件**: 探针抛 `Error('ECONNREFUSED 127.0.0.1:9999')`
- **期望行为**: catch 块中 console.log 参数包含 `error=` 前缀 + 原始 `err.message` 内容（前200字符）
- **断言**: `console.log` spy 被调用，参数字符串匹配 `/error=.*ECONNREFUSED/`；禁止只打 `network_error` 模糊描述
- **对应 FR**: FR-3
- **测试文件**: `sprints/07171300-drift-sentinel-eyes/tests/drift-sentinel-contract.test.js` → `T4`

---

### [BEHAVIOR-T5] 网络全断保守跳过回归

- **触发条件**: `fetchMainSha` 和 `fetchProdSha` 均抛出异常
- **期望行为**: `runDriftCheck` 不 throw；返回 `{ verdict: 'network_error' }`；`consecutiveNetworkErrors` 计数递增
- **断言**: `result.verdict === 'network_error'`，Promise 不 reject
- **对应 FR**: FR-4
- **测试文件**: `sprints/07171300-drift-sentinel-eyes/tests/drift-sentinel-contract.test.js` → `T5`

---

## INV 对应断言

| Invariant | 断言 |
|-----------|------|
| **INV-01** 不得引入路径判据 | `grep -E 'changed_paths|file_filter|path_filter' packages/brain/src/cron/drift-sentinel.js` 输出为空 |
| **INV-02** 补部署必须走 brain-deploy.sh | exec 调用参数包含 `brain-deploy.sh`；FR-15-redeploy 测试 spy 断言 `stringContaining('brain-deploy.sh')` |

---

## manual:bash 可执行验收命令

```bash
# 1. INV-01 断言：无路径判据
grep -E 'changed_paths|file_filter|path_filter' /workspace/packages/brain/src/cron/drift-sentinel.js \
  && echo "FAIL: INV-01 路径判据存在" || echo "PASS: INV-01"

# 2. INV-02 断言：补部署走 brain-deploy.sh
grep 'brain-deploy.sh' /workspace/packages/brain/src/cron/drift-sentinel.js \
  && echo "PASS: INV-02" || echo "FAIL: INV-02 brain-deploy.sh 不存在"

# 3. FR-1 断言：新 HTTPS URL 路径存在，旧 origin/gh api 路径已移除
grep 'https://github.com/perfectuser21/cecelia.git' /workspace/packages/brain/src/cron/drift-sentinel.js \
  && echo "PASS: FR-1 HTTPS URL 存在" || echo "FAIL: FR-1"
grep 'ls-remote origin' /workspace/packages/brain/src/cron/drift-sentinel.js \
  && echo "FAIL: 旧 origin 路径未移除" || echo "PASS: origin 已移除"
grep 'gh api' /workspace/packages/brain/src/cron/drift-sentinel.js \
  && echo "FAIL: gh api 旧路径未移除" || echo "PASS: gh api 已移除"

# 4. FR-2 断言：默认 URL 改为 localhost:5221，外网 URL 已移除
grep 'localhost:5221' /workspace/packages/brain/src/cron/drift-sentinel.js \
  && echo "PASS: FR-2 localhost:5221" || echo "FAIL: FR-2"
grep 'brain.cecelia.ai' /workspace/packages/brain/src/cron/drift-sentinel.js \
  && echo "FAIL: 旧外网 URL 未移除" || echo "PASS: 外网 URL 已移除"

# 5. FR-3 断言：error= 字段存在
grep 'error=' /workspace/packages/brain/src/cron/drift-sentinel.js \
  && echo "PASS: FR-3 error= 字段存在" || echo "FAIL: FR-3"

# 6. 运行合同测试（T1-T5）
cd /workspace/packages/brain && npx vitest run ../../sprints/07171300-drift-sentinel-eyes/tests/drift-sentinel-contract.test.js --reporter=verbose 2>&1 | tail -30

# 7. 零 regression（现有 FR-15 全量测试）
cd /workspace/packages/brain && npx vitest run src/cron/__tests__/drift-sentinel.test.js --reporter=verbose 2>&1 | tail -20
```

---

## DoD Checklist

- [ ] T1 合同测试：修复前 FAIL，修复后 PASS
- [ ] T2 合同测试：修复前 FAIL，修复后 PASS
- [ ] T3 合同测试：修复前 FAIL，修复后 PASS
- [ ] T4 合同测试：修复前 FAIL，修复后 PASS
- [ ] T5 合同测试：全程 PASS（回归保护）
- [ ] INV-01：代码 diff 中无路径判据（grep 验证）
- [ ] INV-02：redeploy 路径调用 brain-deploy.sh（FR-15 测试覆盖）
- [ ] 现有 FR-15 全部测试：PASS（零 regression）
- [ ] PR 合并后回写 Brain 任务状态

---

## rubric JSON

```json
{
  "contract_completeness": {
    "score": 5,
    "note": "5 个 [BEHAVIOR] 条目，覆盖 T1-T5 全部场景"
  },
  "failing_test_first": {
    "score": 5,
    "note": "T1/T2/T3/T4 在当前代码下先失败（旧路径），修复后通过；T5 回归保护"
  },
  "inv_coverage": {
    "score": 5,
    "note": "INV-01/INV-02 均有 grep 断言 + 测试 mock 断言"
  },
  "e2e_verifiability": {
    "score": 5,
    "note": "manual:bash 命令可直接执行，无歧义；e2e-verify 步骤在 contract-draft.md 完整"
  },
  "uncovered_chain": {
    "score": 4,
    "note": "真实网络路径均有豁免说明；步骤 3/4 手动验证覆盖真实 I/O 边"
  },
  "nfr_coverage": {
    "score": 5,
    "note": "NFR-1（范围限制）/NFR-2（无新依赖）/NFR-3（零 regression）均有对应 DoD 项"
  },
  "format_compliance": {
    "score": 5,
    "note": "contract-dod.md 含 5 个 [BEHAVIOR]，manual:bash 可执行，INV 断言完整"
  }
}
```
