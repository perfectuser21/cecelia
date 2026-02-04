# ZenithJoy Engine 流程审计报告

**审计时间**: 2026-01-25
**审计范围**: 完整开发流程（PRD → 合并）
**版本**: v10.6.0

---

## 执行摘要

审计了 `.tmp-flow-analysis.md` 中描述的完整流程，对比实际代码实现，发现：

- ✅ **7 个真实功能**（已实现且工作）
- ❌ **2 个空盒子**（占位符，未真正实现）
- ⚠️ **3 个需要优化的点**（重复/低效）
- 🔧 **1 个配置缺失**（AI Review 未配置）

**总体评估**: 核心流程完整且可用，但有优化空间。

---

## 详细发现

### ✅ 已验证（真实存在且工作）

#### 1. **阶段检测机制**
- **脚本**: `scripts/detect-phase.sh`
- **状态**: ✅ 真实实现
- **功能**: 检测 p0/p1/p2/pending/unknown 阶段
- **调用点**: Stop Hook, /dev 入口
- **验证**: 脚本存在，逻辑完整

#### 2. **Stop Hook 质检强制**
- **脚本**: `hooks/stop.sh`
- **状态**: ✅ 真实实现
- **功能**: 根据阶段强制质检门控
  - p0: 检查 AUDIT-REPORT.md + .quality-gate-passed + PR 创建
  - p1: 检查 CI 状态，fail 则 exit 2
  - p2/pending: 直接放行
- **验证**: 代码逻辑完整，包含防无限循环机制

#### 3. **PR Gate Hook（双模式）**
- **脚本**: `hooks/pr-gate-v2.sh`
- **状态**: ✅ 真实实现
- **功能**:
  - Part 0.5: Preflight（120s 内）
  - Part 1: L1 测试
  - Part 2: L2A 产物检查
  - Part 2.5: L2B-min 证据检查
- **验证**: Hook 逻辑完整，所有 Part 都存在

#### 4. **质检证据生成**
- **脚本**: `scripts/qa-with-gate.sh`
- **状态**: ✅ 真实实现
- **功能**:
  - 运行 typecheck/test/build
  - 生成 .quality-gate-passed
  - 生成 .quality-evidence.json（含 SHA + Audit Decision）
- **验证**: 脚本完整，产物格式正确

#### 5. **L2B 证据检查（双模式）**
- **脚本**: `scripts/devgate/l2b-check.sh`
- **状态**: ✅ 真实实现
- **功能**:
  - PR 模式: L2B-min（文件存在 + 基本格式）
  - Release 模式: L2B-full（DoD 全勾 + 完整证据）
- **验证**: 双模式逻辑清晰，检查严格

#### 6. **DevGate 三合一检查**
- **脚本**:
  - `scripts/devgate/check-dod-mapping.cjs`
  - `scripts/devgate/require-rci-update-if-p0p1.sh`
  - `scripts/devgate/scan-rci-coverage.cjs`
- **状态**: ✅ 全部真实实现
- **功能**:
  1. DoD 映射检查（每个 DoD 条目 → 测试文件）
  2. P0/P1 RCI 更新强制
  3. RCI 覆盖率检查
- **验证**: CI 中全部调用，逻辑完整

#### 7. **CI 11 个 Jobs**
- **文件**: `.github/workflows/ci.yml`
- **状态**: ✅ 全部真实实现
- **Jobs**:
  1. version-check ✅
  2. contract-drift-check ✅
  3. test (L1 + DevGate) ✅
  4. evidence-gate ✅
  5. impact-check ✅
  6. l2b-check ✅
  7. regression-pr ✅
  8. release-check ✅
  9. ci-passed ✅
  10. ai-review ✅（但未配置，见下）
  11. notify-failure ✅
- **验证**: 所有 job 都存在，依赖关系正确

---

### ❌ 空盒子（占位符，未真正实现）

#### 1. **L3-fast 检查（lint/format）**
- **脚本**: `scripts/devgate/l3-fast.sh`
- **问题**: 只是占位符
- **实际行为**:
  ```bash
  npm run lint --if-present || echo "⚠️  lint 未配置，跳过"
  npm run format:check --if-present || echo "⚠️  format:check 未配置，跳过"
  echo "✅ L3 Fast 检查通过（占位符）"
  ```
- **package.json**:
  ```json
  "lint": "echo 'TODO: add eslint'",
  "format:check": "echo 'TODO: add prettier check'"
  ```
- **影响**:
  - Preflight 中的 L3-fast 不起作用
  - 流程文档中说"L3 检查"，但实际上没检查任何东西
- **建议**:
  - 要么补充真实的 lint/format 检查
  - 要么从流程中移除 L3-fast，避免误导

#### 2. **AI Review (L2C) 未配置**
- **CI Job**: `ai-review`
- **问题**: Secret `VPS_REVIEW_URL` 未配置
- **实际行为**:
  ```bash
  if [ -z "$VPS_REVIEW_URL" ]; then
    echo "⚠️ VPS_REVIEW_URL not configured, skipping AI review"
    exit 0
  fi
  ```
- **影响**:
  - AI Review job 每次都跳过
  - 流程文档中说"语义/影响面审查"，但实际上不运行
- **验证**: `gh secret list` 输出中没有 VPS_REVIEW_URL
- **建议**:
  - 配置 VPS_REVIEW_URL secret
  - 或者在文档中说明"AI Review 待配置"

---

### ⚠️ 需要优化的点

#### 1. **Preflight 与 qa:gate 重复跑测试**
- **位置**: Hook Part 0.5 vs Step 7
- **问题**: 重复执行 typecheck + test
- **时间浪费**:
  - qa:gate: ~2 分钟（typecheck + test + build）
  - Preflight: ~1.5 分钟（typecheck + test，重复！）
  - Hook Part 1: ~2 分钟（typecheck + test + build，第三次重复！）
- **影响**: 用户刚跑完 qa:gate，立即 PR 时会再跑 2 次测试
- **优化方案**: Preflight 智能跳过
  ```bash
  # scripts/devgate/ci-preflight.sh 开头添加
  if [[ -f ".quality-gate-passed" ]]; then
    GATE_TIME=$(stat -c %Y .quality-gate-passed 2>/dev/null || stat -f %m .quality-gate-passed)
    NOW=$(date +%s)
    AGE=$((NOW - GATE_TIME))

    if [ $AGE -lt 300 ]; then
      echo "✅ .quality-gate-passed 是新鲜的（${AGE}s 前），跳过 Preflight"
      exit 0
    fi
  fi
  ```
- **效果**: Hook 检查从 2 分钟降到 30 秒

#### 2. **Hook Part 1 与 qa:gate 重复**
- **位置**: Hook Part 1 (L1) vs Step 7
- **问题**: 重复执行 typecheck + test + build
- **是否合理**: ✅ **合理且必要**
- **理由**:
  1. 防绕过：用户可能忘记/跳过 qa:gate
  2. 最终验证：代码可能在 qa:gate 后又改了
  3. 本地强制：Hook 是最后一道本地门
- **建议**: 保持不变（这个重复是必要的）

#### 3. **CI test job 与本地重复**
- **位置**: CI test job vs 本地 qa:gate + Hook
- **问题**: 重复执行 typecheck + test + build
- **是否合理**: ✅ **合理且必要**
- **理由**:
  1. 远端兜底：本地 Hook 可以绕过（删除 settings.json）
  2. 环境差异：本地可能有环境问题，CI 是干净环境
  3. Branch Protection：GitHub 强制要求 CI 通过
- **建议**: 保持不变（这个重复是必要的）

---

### 🔧 配置缺失

#### 1. **GitHub Secret: VPS_REVIEW_URL**
- **状态**: ❌ 未配置
- **影响**: AI Review job 每次跳过
- **修复**:
  ```bash
  gh secret set VPS_REVIEW_URL --body "https://your-vps/webhook/code-review"
  ```
- **优先级**: P2（可选功能，不影响核心流程）

---

## 流程完整性评估

### 真实可用的流程（核心）

```
✅ PRD → 分支创建 → DoD (QA Node) → 写代码+测试
    ↓
✅ 质检循环 (Audit Node + qa:gate) → 生成证据文件
    ↓
✅ PR 创建 (Hook 拦截: Preflight + L1 + L2A + L2B-min)
    ↓
✅ CI 检查 (11 jobs, 除了 ai-review 跳过)
    ↓
✅ p1 修复循环（CI fail → 修复 → push → 继续监控）
    ↓
✅ 合并 + Cleanup
```

### 流程中的"空盒子"

```
❌ L3-fast (lint/format) → 只打印占位符，不检查
❌ AI Review (L2C) → Secret 未配置，跳过
```

---

## 优先级建议

### P0 (立即修复)
无。核心流程完整可用。

### P1 (重要优化)
1. **实施 Preflight 智能跳过**
   - 问题：重复跑测试，浪费 ~1.5 分钟
   - 修复：检查 .quality-gate-passed 时间戳
   - 工作量：5 分钟

### P2 (可选改进)
1. **补充 L3-fast 真实检查**
   - 添加 eslint 配置
   - 添加 prettier 配置
   - 或者移除 L3-fast，简化流程

2. **配置 AI Review**
   - 添加 VPS_REVIEW_URL secret
   - 或者在文档中说明"待配置"

### P3 (文档完善)
1. **更新流程文档**
   - 标注 L3-fast 是占位符
   - 标注 AI Review 待配置
   - 避免误导用户

---

## 总结

### 优点
- ✅ 核心流程完整且可用
- ✅ 质检门控严格（本地 Hook + 远端 CI）
- ✅ 两阶段分离清晰（p0 发 PR / p1 修 CI）
- ✅ 产物追踪完善（证据文件 + SHA 验证）

### 缺点
- ❌ L3-fast 是占位符（误导性）
- ❌ AI Review 未配置（功能缺失）
- ⚠️ Preflight 重复跑测试（效率低）

### 建议
1. **立即实施**: Preflight 智能跳过（5 分钟工作量）
2. **考虑移除**: L3-fast 占位符（如果短期不实现真实检查）
3. **文档更新**: 标注哪些功能是"待实现"

---

## 附录：测试场景验证

### 场景 1: 正常流程（无 CI 失败）
```
用户需求 → /dev → 写代码 → qa:gate (2min) → PR (Hook 2min) → CI (3min) → 合并
总耗时: ~7 分钟（不含写代码）
```

### 场景 2: CI 失败 1 次
```
... → PR → CI fail (3min) → p1 修复 → qa:gate (2min) → push → CI (3min) → 合并
额外耗时: ~8 分钟
```

### 场景 3: 优化后（Preflight 智能跳过）
```
用户需求 → /dev → 写代码 → qa:gate (2min) → PR (Hook 0.5min) → CI (3min) → 合并
总耗时: ~5.5 分钟（节省 1.5 分钟）
```

---

**审计完成日期**: 2026-01-25
**下一步行动**: 实施 Preflight 智能跳过优化
