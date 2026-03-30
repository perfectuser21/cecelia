# Learning: Pipeline Integrity Gate

**Branch**: cp-03301433-pipeline-integrity-gate
**Date**: 2026-03-30
**PR**: #1703（预计）

## 摘要

新增 Pipeline Integrity Gate meta-test，验证 pipeline 安全属性未被削弱。
过程中遇到了 DoD 路径格式、known-failures CI 集成等问题。

## 关键发现

### 发现 1：`tests/` 路径相对于仓库根目录，非 packages/engine/

check-dod-mapping.cjs 使用仓库根目录解析 `tests/xxx` 路径，
但 engine 的测试文件在 `packages/engine/tests/`。

**影响**：Task Card 中 DoD Test 字段写 `tests/pipeline-integrity.test.ts` 会报"文件不存在"。

### 根本原因

check-dod-mapping.cjs `projectRoot` 是仓库根目录，而不是 package 目录。
写 engine 测试时，应使用 `manual:node -e "..."` 格式验证文件存在性，
或使用 `packages/engine/tests/xxx.test.ts` 完整路径（但当前不支持该格式）。

### 下次预防

- [ ] engine 包的 [BEHAVIOR] DoD 条目：用 `manual:node -e "const c=require('fs').readFileSync('packages/engine/tests/xxx.test.ts'...)"` 验证测试内容
- [ ] 不要直接写 `tests/xxx.test.ts`（这假设测试在仓库根目录）

---

### 发现 2：known-failures 走 .quality-evidence.json，不是测试名称匹配

CI 通过 `.quality-evidence.json` 的 `known_failure_keys` 数组来确定哪些失败是已知的，
然后对照 `ci/known-failures.json` 的 `allowed` 字段验证每个 key 是否在白名单中。

**影响**：只更新 ci/known-failures.json 不够，必须同时更新 .quality-evidence.json。

### 根本原因

这是 CI 的双重验证机制：
1. .quality-evidence.json 声明"本次有 N 个已知失败"
2. ci/known-failures.json 作为白名单验证每个 key 合法
3. max_skip_count 限制一次最多跳过 3 个

### 下次预防

- [ ] 有 known-failing 测试时，同时更新 `.quality-evidence.json` 和 `ci/known-failures.json`
- [ ] 注意 max_skip_count=3 的上限（不能同时 known-fail 超过 3 个测试）

---

### 发现 3：[CONFIG] PR title 触发 known-failures.json 保护门

修改 `packages/engine/ci/known-failures.json` 时，CI 的 Config Audit 步骤要求 PR title 含 `[CONFIG]` 或 `[INFRA]` 标签。

### 下次预防

- [ ] 修改 known-failures.json 时，PR title 必须含 [CONFIG]

---

## 架构说明

Pipeline Integrity Gate 的测试维度：

```
pipeline-integrity.test.ts
├── Fail-closed 属性        ← 验证孤儿路径/API失败都走 exit 2/exit 1
├── 反模式扫描              ← 扫描 N次后放行等危险模式
├── 必要文件完整性          ← 验证所有关键文件存在
└── Seal 文件验证逻辑       ← 验证 devloop-check.sh 的 verdict/divergence_count 检查
```

Known-failing（等待 Agent 1 bug fix）：
- `stop-dev.sh fallback` 含内联 gh pr list（应立即 exit 2）
- `lock-utils.sh flock 不可用` 返回 return 0（应返回 return 1）
