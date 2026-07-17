# Sprint PRD — drift-sentinel-eyes（hotfix）

**TASK_ID**: fe385921-603a-449f-ba88-606559fd2d43
**SPRINT_DIR**: sprints/07171300-drift-sentinel-eyes
**HARNESS_GEAR**: hotfix
**日期**: 2026-07-17
**父路**: 交付轴 golden path S0

---

## 问题陈述

`packages/brain/src/cron/drift-sentinel.js` 两个 SHA 探针在容器内均返回 `UNKNOWN`，漂移检测实质失效。

| 探针 | 现实现位置 | 失败根因 |
|------|-----------|---------|
| `defaultFetchMainSha()` | L95-111 | `git ls-remote origin` 容器内不可达；`gh api` 无 auth |
| `defaultFetchProdSha()` | L114-126 | 默认 `https://brain.cecelia.ai` 容器内外网不通 |
| 错误日志 | catch 块 | 只写 `network_error`，无具体错误原文 |

---

## Invariant 约束

| ID | 约束 |
|----|------|
| **INV-01** | 不得引入路径判据（changed_paths / file filter / path filter） |
| **INV-02** | 补部署必须走 `brain-deploy.sh` 全闸，不得绕过 |

---

## 累积 FR

| # | 需求 | 验收标准 |
|---|------|---------|
| **FR-1** | sha_main 容器内可取（公开仓免凭据） | 先 `git ls-remote https://github.com/perfectuser21/cecelia.git main`；失败降级 `curl https://api.github.com/repos/perfectuser21/cecelia/commits/main` 取 `.sha`；返回 ≥7 位 SHA |
| **FR-2** | sha_prod 改用 localhost 自查 | 默认改为 `http://localhost:5221`（Brain 自身进程，容器内可达）；`BRAIN_PROD_URL` 环境变量可覆盖 |
| **FR-3** | 探针失败日志含具体错误原文 | catch 块将 `err.message`（前 200 字符）拼入日志；禁止只写 `network_error` |
| **FR-4** | 回归：网络全断保守跳过 | 两探针均失败 → verdict=network_error；consecutiveNetworkErrors 递增；不抛出 |

**累积 FR 数量：4**

---

## NFR

| # | 要求 |
|---|------|
| NFR-1 | 修改范围严格限于 `defaultFetchMainSha()` / `defaultFetchProdSha()` 两函数及对应 catch 日志 |
| NFR-2 | 不引入新依赖（仅用已有 `child_process.exec` + 内置） |
| NFR-3 | 现有全部测试必须继续通过，零 regression |

---

## 测试要求（先写 failing test）

**T1 — sha_main 容器环境**
- mock: `origin` 不可达 + `gh` 无 auth；`git ls-remote <url>` 返回合法 SHA
- 断言: 现版本 UNKNOWN（failing），修复后返回真 SHA

**T2 — sha_main 二级降级（curl GitHub API）**
- mock: git 全部失败；`curl https://api.github.com/...` 返回 `{"sha":"abc..."}`
- 断言: 修复后返回 `.sha`

**T3 — sha_prod 使用 localhost**
- mock: `curl http://localhost:5221/health` 返回 `{"git_sha":"def..."}`
- 断言: 现版本用外网 URL 失败；修复后返回 `def...`

**T4 — 错误日志含原始错误文本**
- mock: 探针抛 `Error('ECONNREFUSED 127.0.0.1:9999')`
- 断言: 日志字符串包含 `ECONNREFUSED`

**T5 — 网络全断保守跳过（回归）**
- mock: 两探针均抛错
- 断言: 不抛出；verdict=network_error；consecutiveNetworkErrors 递增

---

## 验收标准（Final E2E）

生产容器内下一轮心跳日志输出：
```
[drift_check] sha_main=<真实40位SHA> sha_prod=<真实40位SHA> verdict=ok
```
- `sha_main` 与 `https://github.com/perfectuser21/cecelia` main HEAD 一致
- `sha_prod` 与 `http://localhost:5221/api/brain/health` 返回的 `git_sha` 一致
- 网络正常时不再出现 `UNKNOWN` 或 `verdict=network_error`

---

journey_type: S0
target_environment: local_api
