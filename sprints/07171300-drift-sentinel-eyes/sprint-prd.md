# Sprint PRD — 修漂移哨兵容器内双目失明

**TASK_ID**: fe385921-603a-449f-ba88-606559fd2d43
**Sprint Dir**: sprints/07171300-drift-sentinel-eyes
**Date**: 2026-07-17
**Gear**: hotfix
**Journey Type**: S0 交付轴 golden path
**Target Environment**: local_api

---

## 背景 / 问题陈述

`packages/brain/src/cron/drift-sentinel.js` 的两个 SHA 探针在容器内均返回 `UNKNOWN`，导致 `verdict=network_error`，漂移检测完全失效。

根因：
1. **sha_main** (`defaultFetchMainSha`): 先尝试 `git ls-remote origin HEAD` — 容器内 `origin` 指向本地路径不可达；降级走 `gh api repos/...` — 容器内无 `gh` CLI。两条路都断，抛异常 → UNKNOWN。
2. **sha_prod** (`defaultFetchProdSha`): 使用 `BRAIN_PROD_URL || 'https://brain.cecelia.ai'`，容器内对外网不可达（或配置错误），应改为 `http://localhost:5221`（Brain 进程就跑在同一容器内）。
3. **错误日志**: 失败时只打 `verdict=network_error`，无原始错误信息，定位困难。

---

## Invariant 约束

以下 invariant 从现有代码注释和 Brain 决策库中提取，本次修改必须遵守：

| ID | 约束 |
|----|------|
| INV-01 | 不得引入路径判据（changed_paths / file filter / path filter）|
| INV-02 | 补部署必须走 `brain-deploy.sh` 全闸，不得绕过 |
| INV-04 | 禁 mock `isDrifted()` 判定逻辑与 `runDeploy()` 调用之间的边 |
| INV-09 | 告警不引入路径判据 |
| INV-10 | 补部署触发前须做 SHA 二次核验（`fetchProdSha` 调用 ≥2 次）|

---

## 累积 FR

### FR-FIX-01：sha_main 探针——容器内免凭据获取

**文件**: `packages/brain/src/cron/drift-sentinel.js` → `defaultFetchMainSha()`

修改逻辑（按优先级降级）：
1. **优先**: `git ls-remote https://github.com/perfectuser21/cecelia.git main`（公开仓，无需认证，容器有 git）
2. **降级**: `curl -sf https://api.github.com/repos/perfectuser21/cecelia/commits/main`，取 JSON `.sha` 字段（无需 token）
3. **两条路均失败**: 抛出含原始错误原文的异常

废弃：`git ls-remote origin ...` 和 `gh api ...`（容器内不可用）。

### FR-FIX-02：sha_prod 探针——改用 localhost 自查

**文件**: `packages/brain/src/cron/drift-sentinel.js` → `defaultFetchProdSha()`

修改：`BRAIN_PROD_URL` 默认值从 `'https://brain.cecelia.ai'` 改为 `'http://localhost:5221'`。Brain 进程即本身，容器内 localhost 可达，无需外网。

### FR-FIX-03：错误日志带原始错误原文

**文件**: `packages/brain/src/cron/drift-sentinel.js`

所有 catch 块在打 `verdict=network_error` / `verdict=prod_unreachable` 时，必须附带 `error=<原始错误信息>`。示例：
```
[drift_check] sha_main=UNKNOWN sha_prod=UNKNOWN verdict=network_error error=git ls-remote failed: exit code 128
```

### FR-FIX-04：新增容器环境探针测试

**文件**: `packages/brain/src/cron/__tests__/drift-sentinel.test.js`

新增以下测试场景（TDD 先写 failing，修复后通过）：

| 测试 ID | 描述 | 期望结果 |
|---------|------|---------|
| FR-NEW-container-main | mock 容器网络：`origin` 不可达、`gh` 不可用，仅 `git ls-remote <url>` 和 `curl github api` 可用 → 现版本 UNKNOWN（failing），修复后返回真 SHA | verdict≠network_error，sha_main 有效 |
| FR-NEW-container-prod | mock 容器内 localhost:5221/health 可达，当前代码用外网 URL 失败 → 修复后返回真 SHA | sha_prod 有效 |
| FR-NEW-network-full-down | 所有网络全断（git + curl + localhost 均失败）→ 保守 network_error（回归） | verdict=network_error（保守跳过） |
| FR-NEW-error-log | network_error 日志必须包含原始错误文本 | console.log 参数含 `error=` |

---

## NFR

| ID | 要求 |
|----|------|
| NFR-1 | hotfix 范围：仅修改 `defaultFetchMainSha()` 和 `defaultFetchProdSha()` 两个函数，以及对应 catch 块日志；不改任何业务判定逻辑 |
| NFR-2 | 不引入新依赖，仅使用 `child_process.exec`（已有）和 Node 内置 |
| NFR-3 | 现有 FR-15 全部测试（8 个）必须继续通过，零 regression |
| NFR-4 | 新探针在宿主机（有 gh CLI / origin 可达）环境也必须可用（git ls-remote URL 在宿主也有效）|
| NFR-5 | 修复后下一轮心跳日志格式：`[drift_check] sha_main=<40位SHA> sha_prod=<40位SHA> verdict=ok`（或 drifting/redeploying），不再出现 `UNKNOWN` |

---

## 验收标准（Final E2E）

生产容器内执行下一轮心跳（等待最多 35 分钟，或手动 `runDriftCheck()`）：

```
[drift_check] sha_main=<真实40位SHA> sha_prod=<真实40位SHA> verdict=ok
```

- `sha_main` 与 `https://github.com/perfectuser21/cecelia` main branch HEAD 一致
- `sha_prod` 与 `http://localhost:5221/api/brain/health` 返回的 `git_sha` 一致
- 不再出现 `UNKNOWN` 或 `verdict=network_error`（在网络正常时）

---

## 实现指引

```javascript
// defaultFetchMainSha 新实现骨架
export async function defaultFetchMainSha() {
  const REPO_URL = 'https://github.com/perfectuser21/cecelia.git';
  try {
    const { stdout } = await execAsync(
      `git ls-remote ${REPO_URL} refs/heads/main`,
      { timeout: 15000 }
    );
    const sha = stdout.trim().split(/\s+/)[0];
    if (sha && sha.length >= 7) return sha;
    throw new Error(`git ls-remote returned empty: "${stdout.trim()}"`);
  } catch (gitErr) {
    // 降级：curl GitHub API（公开，免 token）
    try {
      const { stdout: apiOut } = await execAsync(
        `curl -sf --max-time 10 https://api.github.com/repos/perfectuser21/cecelia/commits/main`,
        { timeout: 15000 }
      );
      const data = JSON.parse(apiOut);
      if (data.sha) return data.sha;
      throw new Error(`GitHub API missing .sha: ${apiOut.slice(0, 200)}`);
    } catch (curlErr) {
      throw new Error(`sha_main 两条路均失败: git=${gitErr.message}; curl=${curlErr.message}`);
    }
  }
}

// defaultFetchProdSha 新实现骨架
export async function defaultFetchProdSha() {
  const prodUrl = process.env.BRAIN_PROD_URL || 'http://localhost:5221';
  try {
    const { stdout } = await execAsync(
      `curl -sf --max-time 10 "${prodUrl}/health"`,
      { timeout: 15000 }
    );
    const data = JSON.parse(stdout);
    if (!data.git_sha) throw new Error(`health endpoint missing git_sha: ${stdout.slice(0, 200)}`);
    return data.git_sha;
  } catch (err) {
    throw new Error(`sha_prod fetch failed (${prodUrl}): ${err.message}`);
  }
}
```

---

journey_type: S0
target_environment: local_api
