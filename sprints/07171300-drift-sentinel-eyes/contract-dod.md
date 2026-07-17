# Contract DoD — 漂移哨兵容器内双目失明修复

**TASK_ID**: fe385921-603a-449f-ba88-606559fd2d43
**Sprint Dir**: sprints/07171300-drift-sentinel-eyes
**DoD 版本**: v1.0
**日期**: 2026-07-17

---

## [BEHAVIOR] 条目

[BEHAVIOR] FR-FIX-01-primary: sha_main 探针优先走 git ls-remote https://github.com/perfectuser21/cecelia.git refs/heads/main → 容器内无需凭据即可返回有效 40 位 SHA，不再经过 origin 旧路径

[BEHAVIOR] FR-FIX-01-fallback: sha_main 探针在 git ls-remote 失败时降级走 curl https://api.github.com/repos/perfectuser21/cecelia/commits/main 取 .sha 字段 → 返回有效 SHA，不走 gh api 旧路径

[BEHAVIOR] FR-FIX-01-废弃: git ls-remote origin 和 gh api 两条旧路径从 defaultFetchMainSha() 中移除 → 静态检查不含 "ls-remote origin" 或 'gh api' 字符串

[BEHAVIOR] FR-FIX-02: sha_prod 探针默认 URL 从 https://brain.cecelia.ai 改为 http://localhost:5221 → defaultFetchProdSha() 调用 /health 端点返回 git_sha，容器内 Brain 自查成功

[BEHAVIOR] FR-FIX-03-network-error: verdict=network_error 分支的 console.log 调用必须包含 error=<原始 err.message> 字段 → 日志字符串匹配 /error=/ 且含实际错误原文

[BEHAVIOR] FR-FIX-03-prod-unreachable: verdict=prod_unreachable 分支的 console.log 调用必须包含 error=<原始 err.message> 字段 → 日志字符串匹配 /error=/ 且含实际错误原文

[BEHAVIOR] FR-NEW-container-main: mock 容器网络环境（origin 不可达、gh 不可用、仅 HTTPS git/curl 可用）→ 修复后 sha_main 有效，verdict≠network_error

[BEHAVIOR] FR-NEW-container-prod: mock localhost:5221/health 可达（返回含 git_sha 的 JSON）→ 修复后 sha_prod 有效，verdict≠prod_unreachable

[BEHAVIOR] FR-NEW-network-full-down: 所有路径全断（git ls-remote HTTPS 失败 + curl github api 失败 + curl localhost 失败）→ verdict=network_error，保守跳过，不触发 redeploy，业务判定逻辑不变

[BEHAVIOR] FR-NEW-error-log: network_error 场景 console.log 被调用且参数包含 error= 前缀和原始错误文本 → 测试中 console.log spy 捕获到 /error=/ 匹配

[BEHAVIOR] INV-02-不绕过: redeploying 路径中 exec 调用参数仍为 brain-deploy.sh 全闸 → mockExecDeploy 断言 stringContaining('brain-deploy.sh') 通过

[BEHAVIOR] NFR-3-零回归: 现有 FR-15 全部 8 个测试（ok/debounce/redeploy/network-err/prod-unreach/escalate/boundary×2/首见/skip-x3）继续通过 → 0 failed

---

## 铁律断言

### INV-01：不得引入路径判据

**断言**: `drift-sentinel.js` 代码行（非注释）不含 `changed_paths`、`file.*filter`、`path.*filter`。

```bash
# manual:bash
PATH_FILTER_COUNT=$(grep -E "changed_paths|file.*filter|path.*filter" packages/brain/src/cron/drift-sentinel.js \
  | grep -vcE "^\s*[*/]" || true)
[ "$PATH_FILTER_COUNT" -eq 0 ] && echo "INV-01 PASS" || echo "INV-01 FAIL: ${PATH_FILTER_COUNT} 处路径判据"
```

### INV-02：补部署必须走 brain-deploy.sh 全闸

**断言**: `drift-sentinel.js` 中 brain-deploy.sh 调用存在；单测 FR-15-redeploy 中 mockExecDeploy 断言 stringContaining('brain-deploy.sh')。

```bash
# manual:bash
grep -n "brain-deploy.sh" packages/brain/src/cron/drift-sentinel.js \
  && echo "INV-02 PASS: brain-deploy.sh 调用存在" || echo "INV-02 FAIL"
```

### TDD 纪律：先 failing 后 passing

**断言**: FR-NEW-container-main 和 FR-NEW-container-prod 在修复前为 FAIL（可通过 git log 验证 failing 提交在前），修复后 PASS。

```bash
# manual:bash — 修复后执行（全量通过）
cd /workspace/packages/brain && npx vitest run src/cron/__tests__/drift-sentinel.test.js --reporter=verbose
```

**测试文件路径**: `packages/brain/src/cron/__tests__/drift-sentinel.test.js`

### 错误日志：每个探针失败时必须带具体错误原文

**断言**: 所有 `verdict=network_error` / `verdict=prod_unreachable` 的 console.log 行中含 `error=` 字段。

```bash
# manual:bash — 静态检查
ERROR_FIELD_COUNT=$(grep -n "error=" packages/brain/src/cron/drift-sentinel.js | grep -v "^\s*//" | wc -l)
[ "$ERROR_FIELD_COUNT" -gt 0 ] \
  && echo "错误日志断言 PASS: error= 字段出现 ${ERROR_FIELD_COUNT} 处" \
  || echo "错误日志断言 FAIL: 无 error= 字段"
```

### 保守性：网络全断 → 保持 verdict=network_error

**断言**: `FR-NEW-network-full-down` 测试中，runDriftCheck 返回 `{ verdict: 'network_error' }`，不调用 exec 部署命令。

```bash
# manual:bash — 针对性运行保守性测试
cd /workspace/packages/brain && npx vitest run src/cron/__tests__/drift-sentinel.test.js \
  -t "FR-NEW-network-full-down" --reporter=verbose
```

---

## manual:bash 可执行验收命令

以下命令均在 `/workspace` 根目录执行：

```bash
# 1. smoke 全量静态检查（INV-01/INV-02/审计日志格式/tick-runner 注册）
bash packages/brain/scripts/smoke/drift-sentinel-smoke.sh

# 2. FR-FIX-01 验证：旧 origin 路径已移除
! grep -n "ls-remote origin" packages/brain/src/cron/drift-sentinel.js \
  && echo "OK: origin 旧路径已移除" || echo "FAIL: 仍含 origin 路径"

# 3. FR-FIX-01 验证：旧 gh api 路径已移除
! grep -nE '"gh api|`gh api' packages/brain/src/cron/drift-sentinel.js \
  && echo "OK: gh api 旧路径已移除" || echo "FAIL: 仍含 gh api 路径"

# 4. FR-FIX-01 验证：HTTPS git ls-remote 新路径已加入
grep -n "ls-remote https://github.com/perfectuser21/cecelia.git" \
  packages/brain/src/cron/drift-sentinel.js \
  && echo "OK: HTTPS git ls-remote 新路径已加入" || echo "FAIL: HTTPS 路径缺失"

# 5. FR-FIX-02 验证：默认 URL 已改为 localhost
grep -n "localhost:5221" packages/brain/src/cron/drift-sentinel.js \
  && echo "OK: 默认 URL 已改为 localhost:5221" || echo "FAIL: 仍使用外网 URL"

# 6. FR-FIX-03 验证：error= 字段存在于代码（非注释）
grep -n "error=" packages/brain/src/cron/drift-sentinel.js | grep -v "^\s*//" \
  && echo "OK: error= 字段存在" || echo "FAIL: error= 字段缺失"

# 7. INV-01 断言（路径判据检查）
PATH_FILTER_COUNT=$(grep -E "changed_paths|file.*filter|path.*filter" \
  packages/brain/src/cron/drift-sentinel.js | grep -vcE "^\s*[*/]" || true)
[ "$PATH_FILTER_COUNT" -eq 0 ] && echo "INV-01 PASS" || echo "INV-01 FAIL: ${PATH_FILTER_COUNT} 处"

# 8. INV-02 断言（brain-deploy.sh 调用）
grep -q "brain-deploy.sh" packages/brain/src/cron/drift-sentinel.js \
  && echo "INV-02 PASS" || echo "INV-02 FAIL"

# 9. 全量单测（含原 FR-15 + 新 FR-NEW-*，期望 0 failed）
cd /workspace/packages/brain && npx vitest run src/cron/__tests__/drift-sentinel.test.js --reporter=verbose
```

---

## smoke 脚本引用

**脚本路径**: `packages/brain/scripts/smoke/drift-sentinel-smoke.sh`（已存在）

该脚本当前覆盖：
- 文件存在性、导出符号齐全
- 审计日志 verdict 枚举
- INV-02（brain-deploy.sh 调用存在）
- INV-01（无路径判据，代码区排除注释）
- tick-runner.js 注册
- 防抖窗口 30min 常量
- dedupeKey=drift-escalated 存在

修复完成后建议在 smoke 脚本中追加以下检查（或在 DoD 验收阶段单独运行命令 2-6）：
```bash
# 追加到 drift-sentinel-smoke.sh 末尾（修复后）
! grep -q "ls-remote origin" "$SENTINEL_FILE" \
  || { echo "FAIL: origin 旧路径未移除（FR-FIX-01）"; exit 1; }
grep -q "ls-remote https://github.com/perfectuser21/cecelia.git" "$SENTINEL_FILE" \
  || { echo "FAIL: HTTPS 路径缺失（FR-FIX-01）"; exit 1; }
grep -q "localhost:5221" "$SENTINEL_FILE" \
  || { echo "FAIL: 默认 URL 未改为 localhost（FR-FIX-02）"; exit 1; }
grep -q "error=" "$SENTINEL_FILE" \
  || { echo "FAIL: error= 字段缺失（FR-FIX-03）"; exit 1; }
```

---

## DoD 完成条件汇总

| # | 条件 | 铁律/FR | 验证方式 |
|---|------|---------|---------|
| 1 | defaultFetchMainSha() 使用 HTTPS URL 主路径 | FR-FIX-01 | 静态 grep + 单测 FR-NEW-container-main |
| 2 | defaultFetchMainSha() 降级 curl GitHub API | FR-FIX-01 | 静态 grep + 单测 FR-NEW-container-main |
| 3 | 旧 origin/gh 路径已移除 | FR-FIX-01 | 静态 grep（命令 2/3） |
| 4 | defaultFetchProdSha() 默认 http://localhost:5221 | FR-FIX-02 | 静态 grep + 单测 FR-NEW-container-prod |
| 5 | 所有 catch 块日志含 error= | FR-FIX-03 | 静态 grep + 单测 FR-NEW-error-log |
| 6 | FR-NEW-container-main 测试通过 | TDD 纪律 | npx vitest run |
| 7 | FR-NEW-container-prod 测试通过 | TDD 纪律 | npx vitest run |
| 8 | FR-NEW-network-full-down 测试通过 | 保守性 | npx vitest run |
| 9 | FR-NEW-error-log 测试通过 | 错误日志 | npx vitest run |
| 10 | 原 FR-15 全部 8 个测试零 regression | NFR-3 | npx vitest run |
| 11 | INV-01 无路径判据 | INV-01 | smoke + grep 命令 7 |
| 12 | INV-02 brain-deploy.sh 调用存在 + 单测断言 | INV-02 | smoke + FR-15-redeploy |
| 13 | INV-04 不 mock 判定逻辑边（代码审查） | INV-04 | 代码审查 |
| 14 | INV-10 redeploying 前 fetchProdSha ≥ 2 次 | INV-10 | FR-15-redeploy 单测 |
