# Contract Draft — judge 支持 PASS@L 分级判定 + L3 真机指纹证据执法 + 等级回写

## 任务信息

- **TASK_ID**: 750f5f5b-401a-4379-91c0-948a30327271
- **Sprint**: 07161400-pass-at-level-judge
- **目标文件**: `packages/brain/src/harness-judge.js`
- **测试文件**: `packages/brain/src/__tests__/harness-judge-level.test.js`（新建）

## 技术设计

### 核心变更

1. **`runMechanicalPreflightChecks` 扩展**：在现有三项机械预检后，增加等级声明检测逻辑：
   - 若 `brainResult.verification_level === 'L3'` 或任意 `behavior_tests[i].verification_level === 'L3'`，校验对应条目的 `log_tail`/`screenshot` 是否含真机指纹关键词
   - 真机指纹关键词集合：设备路径（`/data/`、`/sdcard/`、`com.`）、UIA 标识（`UiSelector`、`UiAutomator`、`AccessibilityNodeInfo`、`adb shell`）、截图路径（`.png`、`.jpg` + 绝对路径特征）
   - 纯 curl/vitest 输出（含 `curl ` 前缀且不含设备路径）→ 判 `FAIL mechFail=level_evidence_mismatch`

2. **coverage 等级字段写入**：judge 输出 JSON 的 `coverage[i]` 增加 `verification_level` 字段，写实际达到等级

3. **design_docs 落库**：PASS 时落 `design_docs` 表一条 `type='judge_level_report'`，记录各步实际等级

### 兼容性

- `brainResult` 无 `verification_level` 字段 → 默认 L2，不 FAIL（存量兼容）
- `behavior_tests` 条目无 `verification_level` → 继承顶层值（无顶层则 L2 默认）
- 条目级 `verification_level` 优先于顶层

## E2E 验收

```bash
# 验收环境：local_api（vitest 单元测试，不依赖外部服务）
# 执行命令：
npx vitest run packages/brain/src/__tests__/harness-judge-level.test.js

# 验收点 1：L3 声明 + 纯 curl 证据 → 修复后 FAIL（mechFail=level_evidence_mismatch）
# 构造 brainResult：verification_level:'L3'，behavior_tests[0].log_tail:'curl http://localhost:5221/health'
# 期望：runMechanicalPreflightChecks 返回 { verdict:'FAIL', mechFail:'level_evidence_mismatch' }

# 验收点 2：存量无 verification_level 字段 → 行为不变（兼容回归）
# 构造 brainResult：无 verification_level，behavior_tests 含正常 exit_code + log_tail
# 期望：runMechanicalPreflightChecks 返回 null（通过，不 FAIL）

# 验收点 3：L3 + 含真机指纹关键词证据 → PASS
# 构造 brainResult：verification_level:'L3'，log_tail 含 'adb shell dumpsys'
# 期望：runMechanicalPreflightChecks 返回 null（通过）

# 验收点 4：条目级 verification_level 优先于顶层
# 顶层 L2，behavior_tests[0].verification_level:'L3'，log_tail 纯 curl
# 期望：FAIL mechFail=level_evidence_mismatch（条目级 L3 被执法）
```

## Test Contract

| # | [BEHAVIOR] 覆盖描述 | 测试 it() 名称（子串） | 状态 |
|---|---|---|---|
| 1 | [BEHAVIOR] L3 声明 + 纯 curl 证据 → FAIL mechFail=level_evidence_mismatch | L3 声明 + 纯 curl 证据 → 修复后应 FAIL mechFail=level_evidence_mismatch | ✅ |
| 2 | [BEHAVIOR] L3 声明 + 纯 vitest 输出 → FAIL mechFail=level_evidence_mismatch | L3 声明 + 纯 vitest 输出 → 修复后应 FAIL mechFail=level_evidence_mismatch | ✅ |
| 3 | [BEHAVIOR] 存量无 verification_level 字段 → 行为不变（L2 兼容回归） | 兼容回归：存量无 verification_level 字段 → 返回 null（不 FAIL） | ✅ |
| 4 | [BEHAVIOR] L3 + 真机指纹关键词证据 → PASS（不过度拦截） | 真机指纹：L3 + adb shell 输出 → 返回 null（PASS） | ✅ |
| 5 | [BEHAVIOR] 条目级 verification_level 优先于顶层声明 | 条目级优先：顶层 L2 + 条目 L3 + 纯 curl → 按条目 L3 执法 → FAIL | ✅ |
| 6 | [BEHAVIOR] curl 前缀但同时含设备路径关键词 → PASS（边界不过度拦截） | curl混合设备路径：curl 前缀 + /data/ 设备路径 → 返回 null（不拦截） | ✅ |

## 产物清单

- `sprints/07161400-pass-at-level-judge/contract-draft.md`（本文件）
- `sprints/07161400-pass-at-level-judge/contract-dod.md`（DoD 条目）
- `sprints/07161400-pass-at-level-judge/tests/harness-judge-level.test.js`（测试文件）
- `packages/brain/src/__tests__/harness-judge-level.test.js`（正式测试位置，CI 永久留存）
