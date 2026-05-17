---
id: phase1-brain-review
version: 1.0.0
created: 2026-02-25
updated: 2026-02-26
changelog:
  - 1.0.0: 初始版本 - packages/brain 核心调度模块审查
---

# Bug 审查 Phase 1: packages/brain (核心调度)

**审查日期**: 2026-02-26
**审查范围**: packages/brain/src/
**重点文件**: executor.js, tick.js, thalamus.js, cortex.js, task-router.js, slot-allocator.js, alertness-actions.js

---

## 审查摘要

- 审查文件数: 7 个核心文件
- 发现问题数: L1: 2, L2: 7, L3: 3
- 总体评估: 代码质量良好，但存在若干需要修复的问题

---

## L1 阻塞性问题（必须修复）

### [L1-001] tick.js - Tick 锁释放存在竞争条件

- **文件**: `packages/brain/src/tick.js:191-199`
- **问题**: 超时保护中释放 `_tickRunning` 锁时没有原子性保证。如果在释放过程中有新的 tick 进入，可能导致状态不一致。
- **风险**: 可能导致多个 tick 同时执行，任务被重复派发
- **建议修复**:
```javascript
// 方案1: 使用 Mutex 或更严格的锁机制
// 方案2: 在 finally 块中使用 CAS 操作确保原子性
if (_tickLockTime && (Date.now() - _tickLockTime > TICK_TIMEOUT_MS)) {
  // 添加额外的状态检查
  if (_tickRunning && Date.now() - _tickLockTime > TICK_TIMEOUT_MS * 2) {
    console.warn(`[tick-loop] Tick lock held for >${TICK_TIMEOUT_MS * 2}ms, force-releasing`);
    _tickRunning = false;
    _tickLockTime = null;
  }
}
```

### [L1-002] executor.js - Bridge 任务 PID 为 null 时的处理不完整

- **文件**: `packages/brain/src/executor.js:488-493`
- **问题**: 当任务通过 bridge 派发时（无本地 PID），`killProcess` 会删除 activeProcesses 但返回 false，调用方可能误判为"进程不存在"而非"已清理"。
- **风险**: 可能导致僵尸任务追踪，影响资源计数准确性
- **建议修复**:
```javascript
function killProcess(taskId) {
  const entry = activeProcesses.get(taskId);
  if (!entry) return false;

  if (!entry.pid) {
    console.log(`[executor] Skipping kill task=${taskId}: pid is null (bridge-tracked)`);
    activeProcesses.delete(taskId);
    // 标记为已清理，而不是返回 false
    entry.killed = true;
    return true;  // 修改返回值
  }
  // ...
}
```

---

## L2 功能性问题（建议修复）

### [L2-001] tick.js - TASK_TYPE_AGENT_MAP 死代码

- **文件**: `packages/brain/src/tick.js:47-53`
- **问题**: TASK_TYPE_AGENT_MAP 定义了映射关系，但在代码中没有被使用（实际路由逻辑在 executor.js 的 getSkillForTaskType 函数中）
- **风险**: 维护困难，可能导致代码不一致
- **建议修复**: 删除此死代码，或确认是否真的需要

### [L2-002] tick.js - 恢复逻辑缺陷

- **文件**: `packages/brain/src/tick.js:298-340`
- **问题**: `tryRecoverTickLoop()` 清除 `_recoveryTimer` 后立即返回，但如果后续启动失败（比如数据库连接失败），没有重新设置恢复 timer
- **风险**: 如果 tick loop 启动失败，系统将不会重试，可能导致长时间的服务中断
- **建议修复**:
```javascript
async function tryRecoverTickLoop() {
  // ...
  try {
    // 启动逻辑
    if (_recoveryTimer) {
      clearInterval(_recoveryTimer);
      _recoveryTimer = null;
    }
    await _recordRecoveryAttempt(true);
  } catch (err) {
    console.error(`[tick-loop] Recovery attempt failed: ${err.message}`);
    await _recordRecoveryAttempt(false, err.message);
    // 确保恢复 timer 继续运行
    if (!_recoveryTimer) {
      _recoveryTimer = setInterval(tryRecoverTickLoop, INIT_RECOVERY_INTERVAL_MS);
    }
  }
}
```

### [L2-003] thalamus.js - LLM 错误分类不完整

- **文件**: `packages/brain/src/thalamus.js:45-66`
- **问题**: `classifyLLMError` 函数只处理了部分错误类型，对于一些常见的 API 错误（如 429 Rate Limit）处理不够精细
- **风险**: 错误统计不准确，可能影响系统决策
- **建议修复**: 扩展错误分类，增加更多具体错误码的处理

### [L2-004] cortex.js - API 调用缺少细粒度错误处理

- **文件**: `packages/brain/src/cortex.js:175-219`
- **问题**: `callCortexLLM` 函数捕获 API 错误后统一抛出，没有区分不同错误类型进行不同处理（如配额超限 vs 网络错误）
- **风险**: 无法针对不同错误进行精确降级，可能导致不必要的系统升级
- **建议修复**:
```javascript
if (!response.ok) {
  const error = await response.text();
  if (response.status === 429) {
    throw new Error('Cortex rate limit exceeded');
  }
  if (response.status >= 500) {
    throw new Error(`Cortex server error: ${response.status}`);
  }
  throw new Error(`Cortex API error: ${response.status} - ${error}`);
}
```

### [L2-005] slot-allocator.js - 会话检测存在竞争条件

- **文件**: `packages/brain/src/slot-allocator.js:42-81`
- **问题**: `detectUserSessions` 使用 execSync 同步检测进程，在检测过程中进程可能启动或退出，导致计数不准确
- **风险**: 槽位计算不准确，可能导致过度派发或资源浪费
- **建议修复**: 添加二次验证或使用更可靠的进程检测机制

### [L2-006] alertness-actions.js - 状态持久化缺失

- **文件**: `packages/brain/src/alertness-actions.js:31-35`
- **问题**: `_mitigationState` 只存储在内存中，服务重启后会丢失之前的状态
- **风险**: 重启后的恢复逻辑可能不完整，需要手动干预
- **建议修复**: 将关键状态持久化到数据库或 working_memory

### [L2-007] alertness-actions.js - 数据库操作缺少错误处理

- **文件**: `packages/brain/src/alertness-actions.js:127-136, 299-308`
- **问题**: `notifyAlert` 和 `recoverFromLevel` 函数中的数据库操作没有 try-catch 保护
- **风险**: 如果数据库暂时不可用，可能导致整个响应链失败
- **建议修复**:
```javascript
export async function notifyAlert(level, signals) {
  // ... console.log 代码 ...
  try {
    await pool.query(...);
  } catch (dbErr) {
    console.error(`[alertness] Failed to record notification: ${dbErr.message}`);
  }
}
```

---

## L3 最佳实践（建议改进）

### [L3-001] task-router.js - 正则表达式未预编译

- **文件**: `packages/brain/src/task-router.js:10-40`
- **问题**: SINGLE_TASK_PATTERNS 和 FEATURE_PATTERNS 数组中的正则表达式在每次调用 `identifyWorkType` 时都被重新测试，没有预编译
- **建议修复**: 在模块加载时预编译正则表达式
```javascript
const SINGLE_TASK_PATTERNS = [
  /修复/i,
  /fix/i,
  // ...
].map(pattern => ({ regex: new RegExp(pattern), original: pattern }));

function identifyWorkType(input) {
  for (const { regex } of SINGLE_TASK_PATTERNS) {
    if (regex.test(input)) return 'single';
  }
  // ...
}
```

### [L3-002] executor.js - 重复的模型映射逻辑

- **文件**: `packages/brain/src/executor.js:864-892`
- **问题**: `getModelForTask` 和 `getProviderForTask` 函数有相似逻辑，可以提取公共部分
- **建议修复**: 抽取公共逻辑到独立函数

### [L3-003] 代码注释风格不一致

- **问题**: 部分文件使用中文注释，部分使用英文注释
- **建议修复**: 统一注释语言风格（建议统一使用英文或中文）

---

## 测试覆盖评估

| 模块 | 测试文件数 | 覆盖评估 |
|------|-----------|---------|
| executor.js | 20+ | 良好 |
| tick.js | 5+ | 良好 |
| thalamus.js | 1 | 需加强 |
| cortex.js | 5+ | 良好 |
| task-router.js | 0 | 需补充 |
| slot-allocator.js | 0 | 需补充 |
| alertness-actions.js | 2 | 良好 |

---

## 总结与建议

### 优先级修复顺序

1. **立即修复 (P0)**:
   - [L1-001] Tick 锁竞争条件
   - [L1-002] Bridge 任务 PID 处理

2. **本周修复 (P1)**:
   - [L2-002] 恢复逻辑缺陷
   - [L2-007] 数据库错误处理
   - [L2-006] 状态持久化

3. **下个迭代 (P2)**:
   - [L2-001] 死代码清理
   - [L2-003], [L2-004] 错误处理增强
   - [L2-005] 会话检测优化
   - [L3] 最佳实践改进

### 整体评价

packages/brain 核心调度模块整体代码质量良好，架构设计清晰。主要问题集中在：

1. **并发安全**: Tick 锁和进程检测存在竞争条件
2. **错误处理**: 某些关键路径的错误处理不够完善
3. **状态管理**: 内存状态与服务重启后的恢复逻辑需要加强

建议优先修复 L1 问题，确保系统稳定性。
