# Contract DoD — G1：Gate3 GIT_SHA 对账

- sprint_dir: sprints/07161500-gate3-sha-truth
- task_id: 9039956f-cd80-4991-aa4c-f19960a028e1
- 日期: 2026-07-16
- 版本: v2（GAN Round 2，修复 F-01..F-05）

---

## [BEHAVIOR] 条目

### [BEHAVIOR-01] squash merge 场景：SHA 不等必须触发部署

**描述**：当 CI 获取到生产容器 `/health.git_sha`（PROD_SHA）与当前 `git rev-parse HEAD`（HEAD_SHA）不等时，不论 `--changed` 路径列表是否为空，`brain-ci-deploy.yml` 的 deploy job 必须调用 `/api/brain/deploy` 并以 2xx 为成功。

**当前状态**：FAILING（旧路径依赖 `gate3-changed-paths.sh` 输出，squash merge 后 changed 为空导致假跳过）

**验收命令（manual:bash）**：
```bash
# 构造 fixture：旧 PROD_SHA
PROD_SHA="0000000000000000000000000000000000000000"
HEAD_SHA=$(git rev-parse HEAD)

# 验证 SHA 不等（前提）
[ "$PROD_SHA" != "$HEAD_SHA" ] && echo "PRECONDITION_OK: SHA 不等" || echo "PRECONDITION_FAIL"

# 运行串链测试（新路径）
bash sprints/07161500-gate3-sha-truth/tests/sha-account.test.sh \
  --scenario squash_merge_sha_diff
# 期望：EXIT 0，stdout 含 "DEPLOY_TRIGGERED"
```

---

### [BEHAVIOR-02] SHA 相等时跳过部署（幂等防护）

**描述**：当 PROD_SHA == HEAD_SHA 时，`brain-ci-deploy.yml` deploy job 必须跳过部署调用，不触发 `/api/brain/deploy`，输出 "SHA 相同，跳过" 类提示。

**当前状态**：PASSING（旧路径版本对比已有类似逻辑，新路径需保留）

**验收命令（manual:bash）**：
```bash
HEAD_SHA=$(git rev-parse HEAD)

bash sprints/07161500-gate3-sha-truth/tests/sha-account.test.sh \
  --scenario sha_equal_skip \
  --mock-prod-sha "$HEAD_SHA"
# 期望：EXIT 0，stdout 含 "SKIP_DEPLOY" 或 "SHA 相同"
# 反断言：stdout 不含 "DEPLOY_TRIGGERED"
```

---

### [BEHAVIOR-03] /health 端点返回 git_sha 字段（构建期烙入）

**描述**：生产容器（及本地 `docker run` 带 `--build-arg GIT_SHA=<sha>`）的 `/api/brain/health` 响应体必须包含 `git_sha` 字段，值为构建时的 40 位 hex SHA（非 `null`，非 `"unknown"`）。

**当前状态**：FAILING（`ops.js` health handler 当前响应体无 `git_sha` 字段；Dockerfile 无 `ARG GIT_SHA`）

**验收命令（manual:bash）**：
```bash
# 本地验证（需先构建带 GIT_SHA 的镜像）
TEST_SHA="abc1234deadbeefabc1234deadbeefabc1234de"

docker build -t cecelia-brain:sha-test \
  --build-arg GIT_SHA="$TEST_SHA" \
  -f packages/brain/Dockerfile . \
  --quiet

# 容器内 env 验证（构建期烙入）
docker run --rm cecelia-brain:sha-test printenv GIT_SHA
# 期望：输出 "$TEST_SHA"

# 如果 Brain 本地运行中，验证 /health 端点
curl -s http://localhost:5221/api/brain/health | \
  node -e "
    const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
    if (!d.git_sha || d.git_sha === 'unknown') {
      console.error('FAIL: git_sha 缺失或为 unknown');
      process.exit(1);
    }
    console.log('PASS: git_sha =', d.git_sha);
  "
```

---

### [BEHAVIOR-04] S6 SHA 回读断言：不匹配则 ROLLBACK exit 1

**描述**：`scripts/brain-deploy.sh` 部署成功后，必须执行 `/health.git_sha` 回读并与 `EXPECTED_SHA` 对比。不等时输出含 "ROLLBACK" 或 "SHA 不匹配" 的错误信息，并以 exit 1 退出（走既有回滚 trap）。

**当前状态**：FAILING（`brain-deploy.sh` 无 SHA 回读逻辑）

**验收命令（manual:bash）**：
```bash
# 构造 fixture：health 返回错误 SHA
WRONG_SHA_JSON='{"ok":true,"version":"1.0.0","git_sha":"deadbeef00000000deadbeef00000000deadbeef","uptime_seconds":5}'
FIXTURE=$(mktemp)
echo "$WRONG_SHA_JSON" > "$FIXTURE"

# 注入 fixture + 期望正确 SHA（与 fixture 不同）
EXPECTED_SHA="abc1234abc1234abc1234abc1234abc1234abc12"
HEALTH_JSON_OVERRIDE="$FIXTURE" \
EXPECTED_SHA="$EXPECTED_SHA" \
bash scripts/brain-deploy.sh --dry-run --sha-check-only 2>&1
CODE=$?
rm -f "$FIXTURE"

[ $CODE -ne 0 ] && echo "PASS: exit $CODE（非零，ROLLBACK 触发）" \
              || echo "FAIL: exit 0（应 exit 1）"
```

---

### [BEHAVIOR-05] gate3-changed-paths.sh 调用从 CI workflow 中移除

**描述**：`brain-ci-deploy.yml` 的 deploy job 不得再包含 `gate3-changed-paths.sh` 调用或 `changed_paths` 相关的条件跳过逻辑。

**当前状态**：FAILING（workflow 当前含「计算变更路径」step）

**验收命令（manual:bash）**：
```bash
# 断言 workflow 不含 changed-paths 调用
grep -n "gate3-changed-paths\|changed_paths" .github/workflows/brain-ci-deploy.yml
# 期望：grep 返回非零（无匹配），或仅存在于注释行

# 断言 workflow 含 SHA 对账关键词
grep -n "PROD_SHA\|HEAD_SHA\|git_sha\|rev-parse HEAD" .github/workflows/brain-ci-deploy.yml | head -10
# 期望：至少 2 行命中
```

---

### [BEHAVIOR-06] curl /health 失败或 git_sha=unknown → fail open（保守部署）

**描述**：当 CI 中 `curl /health` 超时或返回 `git_sha: "unknown"` 时，SHA 对账逻辑必须保守视为「需部署」（fail open），不得跳过部署。

**当前状态**：NOT_IMPLEMENTED（新增行为）

**验收命令（manual:bash）**：
```bash
bash sprints/07161500-gate3-sha-truth/tests/sha-account.test.sh \
  --scenario health_unreachable_fail_open
# 期望：EXIT 0，stdout 含 "FAIL_OPEN_DEPLOY"（保守触发部署）

bash sprints/07161500-gate3-sha-truth/tests/sha-account.test.sh \
  --scenario health_git_sha_unknown_fail_open
# 期望：EXIT 0，stdout 含 "FAIL_OPEN_DEPLOY"
```

---

### [BEHAVIOR-07] /api/brain/deploy 空 body 返回 2xx，不含 skipped:true

**描述**：`POST /api/brain/deploy` 请求 body 为空对象 `{}` 时，handler 必须返回 HTTP 2xx（202 Accepted 或 200），响应体不含 `skipped: true` 字段。此断言覆盖 FR-04（去除 `changed_paths` 为空时的跳过逻辑），与 BEHAVIOR-01（workflow 层）互补，专门验证 handler 层行为。

**当前状态**：FAILING（`ops.js` deploy handler 当前对空 `changed_paths` 返回 skipped 或不触发部署）

**验收命令（manual:bash）**：
```bash
# 前提：Brain 服务本地运行（localhost:5221）
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST http://localhost:5221/api/brain/deploy \
  -H "Content-Type: application/json" \
  -d '{}')

HTTP_BODY=$(echo "$RESPONSE" | head -n -1)
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

# 断言 1：HTTP 2xx
if [[ "$HTTP_CODE" =~ ^2 ]]; then
  echo "PASS: HTTP ${HTTP_CODE}"
else
  echo "FAIL: HTTP ${HTTP_CODE}（期望 2xx）"; exit 1
fi

# 断言 2：不含 skipped:true
if echo "$HTTP_BODY" | grep -q '"skipped":true\|"skipped": true'; then
  echo "FAIL: 响应含 skipped:true（changed_paths 为空时仍跳过部署）"; exit 1
else
  echo "PASS: 响应不含 skipped:true"
fi
```

---

## 执行检查单（DoD Checklist）

```
[ ] FR-01 Dockerfile 含 ARG GIT_SHA + ENV GIT_SHA=${GIT_SHA}
[ ] FR-01 brain-deploy.sh 含 --build-arg GIT_SHA=$(git rev-parse HEAD)
[ ] FR-02 /health 响应含 git_sha 字段（BEHAVIOR-03 通过）
[ ] FR-03 brain-ci-deploy.yml 无 gate3-changed-paths.sh（BEHAVIOR-05 通过）
[ ] FR-03 brain-ci-deploy.yml 含 SHA 对账 step（PROD_SHA vs HEAD_SHA）
[ ] FR-04 /deploy handler 空 changed_paths 时不跳过（BEHAVIOR-01 + BEHAVIOR-07 通过）
[ ] FR-05 brain-deploy.sh S6 SHA 回读断言（BEHAVIOR-04 通过）
[ ] FR-05 brain-deploy.sh 支持 --sha-check-only flag（接受 HEALTH_JSON_OVERRIDE 注入，不执行实际部署）
[ ] FR-06 sha-account.test.sh squash 场景旧路径 FAIL + 新路径 PASS
[ ] FR-06 sha-account.test.sh SHA 相等跳过 PASS（BEHAVIOR-02 通过）
[ ] FR-06 测试已加入 brain-ci-deploy.yml L1 矩阵
[ ] FR-07 gate3-brain-deploy-smoke.sh 新增 SHA 回读 E 场景并全绿
[ ] INV-02 蓝绿相关文件未改动（git diff --name-only 无 bluegreen.sh）
[ ] INV-04 GIT_SHA ENV 在 runtime FROM 层（非仅 deps 层）
[ ] INV-08 gate3-changed-paths.sh 删除后无死代码注释残骸（grep "gate3-changed-paths" brain-ci-deploy.yml 返回零行或仅有说明性注释；grep 活跃代码行返回零）
```

---

## CI 防线映射

| BEHAVIOR | 测试文件 | CI job |
|---------|---------|--------|
| BEHAVIOR-01 | tests/sha-account.test.sh (squash_merge_sha_diff) | brain-ci-deploy.yml L1 |
| BEHAVIOR-02 | tests/sha-account.test.sh (sha_equal_skip) | brain-ci-deploy.yml L1 |
| BEHAVIOR-03 | tests/sha-account.test.sh (health_returns_git_sha) | brain-ci-deploy.yml L1 |
| BEHAVIOR-04 | tests/sha-account.test.sh (s6_sha_mismatch_rollback) | brain-ci-deploy.yml L1 |
| BEHAVIOR-05 | tests/sha-account.test.sh (workflow_no_changed_paths) | brain-ci-deploy.yml L1 |
| BEHAVIOR-06 | tests/sha-account.test.sh (health_unreachable_fail_open) | brain-ci-deploy.yml L1 |
| BEHAVIOR-07 | tests/sha-account.test.sh (deploy_empty_body_not_skipped) | brain-ci-deploy.yml L1 |
| FR-07 | scripts/smoke/gate3-brain-deploy-smoke.sh（SHA 回读 E 场景） | brain-ci-deploy.yml smoke job |
