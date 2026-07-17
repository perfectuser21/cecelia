# DoD — 漂移哨兵容器内双目失明修复

**TASK_ID**: fe385921-603a-449f-ba88-606559fd2d43
**Sprint Dir**: sprints/07171300-drift-sentinel-eyes

---

## 行为定义

[BEHAVIOR] sha_main 探针在容器内使用 git ls-remote 公开 HTTPS URL 获取 main HEAD SHA → 返回 40 位 SHA 字符串，不再返回 UNKNOWN
[BEHAVIOR] sha_main 探针当 git ls-remote 失败时降级为 curl GitHub API（无需 token）→ 仍返回有效 SHA
[BEHAVIOR] sha_prod 探针默认使用 localhost:5221/health 获取运行中实例 SHA → 返回 git_sha 字段，不再返回 UNKNOWN
[BEHAVIOR] 所有探针失败时 console.log 必须包含 error=<原始错误原文>，不得仅打 verdict=network_error 无详情
[BEHAVIOR] 网络全断（所有路径均失败）时 verdict 仍为 network_error（保守跳过，业务逻辑不变）
[BEHAVIOR] INV-01: 修改后代码不含 changed_paths / file filter / path filter 任何路径判据
[BEHAVIOR] INV-02: 补部署路径不变，runDriftCheck 仍调用 brain-deploy.sh，不绕过

---

## 测试文件

- 单测: `packages/brain/src/cron/__tests__/drift-sentinel.test.js`
- Smoke: `packages/brain/scripts/smoke/drift-sentinel-smoke.sh`
- E2E: `sprints/07171300-drift-sentinel-eyes/e2e-verify.sh`

新增测试场景（TDD 先红后绿）：
- FR-NEW-container-main: mock 容器网络（origin/gh 不可用，git ls-remote URL 可用）→ 修复后返回真 SHA
- FR-NEW-container-prod: mock localhost:5221/health 可达 → 修复后返回 git_sha
- FR-NEW-network-full-down: 所有路径全断 → 保守 network_error（回归）
- FR-NEW-error-log: network_error 日志含 error= 原文

---

## 验收命令

manual:bash vitest run packages/brain/src/cron/__tests__/drift-sentinel.test.js
manual:bash grep -q 'perfectuser21/cecelia.git' packages/brain/src/cron/drift-sentinel.js && echo 'PASS: sha_main 改公开 URL'
manual:bash grep -q 'localhost:5221' packages/brain/src/cron/drift-sentinel.js && echo 'PASS: sha_prod 改 localhost'
manual:bash grep -q 'error=' packages/brain/src/cron/drift-sentinel.js && echo 'PASS: error= 字段存在'
manual:bash bash packages/brain/scripts/smoke/drift-sentinel-smoke.sh

---

## 铁律对照表

| 铁律 | 断言 |
|------|------|
| INV-01 | grep 不含 changed_paths/file filter |
| INV-02 | brain-deploy.sh 调用不变（由现有 FR-15-redeploy 测试覆盖） |
| TDD | generator 先提交 failing test commit（(Red)），再提交实现（(Green)） |
| 错误日志 | 每个 catch 块 console.log 参数含 `error=` |
| 保守性 | FR-NEW-network-full-down 验证：全断时 verdict=network_error |

---

## DoD 勾选清单

- [ ] `defaultFetchMainSha()` 改用 `git ls-remote https://github.com/perfectuser21/cecelia.git refs/heads/main`
- [ ] `defaultFetchMainSha()` 降级为 `curl https://api.github.com/repos/perfectuser21/cecelia/commits/main`
- [ ] `defaultFetchProdSha()` 默认 URL 改为 `http://localhost:5221`
- [ ] 所有 catch 块日志含 `error=<err.message>`
- [ ] 新增 4 个 FR-NEW-* 测试（先写 failing，再通过）
- [ ] 现有 FR-15 全部 8 个测试零 regression
- [ ] CI 全绿
