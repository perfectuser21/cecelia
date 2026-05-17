# Cecelia Core 派发监控和熔断 - 完整探索报告索引

生成时间：2026-02-19  
探索范围：/home/xx/perfect21/cecelia/core/brain/src/  
只读模式：仅代码探索，未做任何修改

---

## 文档导航

本次探索生成了 3 份完整文档，按用途选择：

### 1. DISPATCH_EXPLORATION.md（深度分析）
**567 行，15 个章节，完全详解**

适用场景：
- 需要理解完整的派发机制
- 学习系统架构和设计决策
- 分析派发失败原因
- 查阅数据库存储方式

主要内容：
- 派发成功率统计（dispatch-stats）完整分析
- 电路熔断器（circuit-breaker）三态机制
- 派发执行流程（executor）资源检查
- 派发检查链（tick.js）完整流程
- 现有熔断机制总结
- 关键文件速查表
- API 查询方式

---

### 2. DISPATCH_QUICK_REFERENCE.md（快速查询）
**294 行，实用速查表**

适用场景：
- 快速定位代码位置
- 查询关键常数
- 理解失败原因码
- 获取排查步骤
- 学习测试用例

主要内容：
- 文件位置和行号速查
- 关键常数速查
- 派发失败原因码映射
- 派发成功率监控流程图
- 电路熔断状态转移图
- 派发检查链完整列表
- 常见排查步骤

---

### 3. CODE_SNIPPETS_DISPATCH.md（代码参考）
**494 行，8 个代码片段集合**

适用场景：
- 需要查看具体实现代码
- 学习单元测试写法
- 复制关键代码片段
- 理解数据结构

主要内容：
- 派发成功率统计核心代码（computeWindow1h, recordDispatchResult）
- 电路熔断器核心代码（isAllowed, recordFailure, recordSuccess）
- 派发执行流程核心代码（checkServerResources, triggerCeceliaRun）
- tick.js 派发流程核心代码
- 测试代码片段（3 个单元测试）
- 派发失败原因映射表
- 常用查询命令（SQL + Bash）
- 数据结构完整定义

---

## 快速导航

### 我要找...

#### 关键文件位置
→ 查看 **DISPATCH_QUICK_REFERENCE.md - 文件位置速查**

#### 派发成功率统计如何工作
→ 查看 **DISPATCH_EXPLORATION.md - 第 1 章**  
或  **CODE_SNIPPETS_DISPATCH.md - 第 1 节**

#### 电路熔断器三态转移
→ 查看 **DISPATCH_EXPLORATION.md - 第 2 章**  
或  **DISPATCH_QUICK_REFERENCE.md - 电路熔断状态转移图**  
或  **CODE_SNIPPETS_DISPATCH.md - 第 2 节**

#### 派发执行的完整检查流程
→ 查看 **DISPATCH_QUICK_REFERENCE.md - 派发检查链**  
或  **DISPATCH_EXPLORATION.md - 第 4 章**

#### 派发失败的原因及恢复时间
→ 查看 **DISPATCH_QUICK_REFERENCE.md - 派发失败原因码**

#### 低成功率保护机制
→ 查看 **DISPATCH_EXPLORATION.md - 第 5 章**  
标注：设计完成，检查点待实现

#### 资源检查如何工作
→ 查看 **DISPATCH_EXPLORATION.md - 第 3 章 - checkServerResources**  
或  **CODE_SNIPPETS_DISPATCH.md - 第 3 节**

#### SQL 查询派发统计
→ 查看 **CODE_SNIPPETS_DISPATCH.md - 第 7 节 - PostgreSQL 查询**

#### 如何排查派发问题
→ 查看 **DISPATCH_QUICK_REFERENCE.md - 常见排查步骤**

---

## 核心发现总结

### 1. 派发成功率监控
- **存储位置**：PostgreSQL working_memory 表，key = `dispatch_stats`
- **窗口大小**：1 小时（3,600,000 ms）
- **最小样本**：10 次派发
- **成功率阈值**：30%（低于此值触发保护）
- **失败原因**：11 种分类（draining, billing_pause, circuit_breaker_open 等）
- **状态**：实现完成，支持失败原因详细统计

### 2. 电路熔断器
- **存储位置**：内存 Map，key = worker identifier（如 'cecelia-run'）
- **触发条件**：连续 3 次失败
- **冷却时间**：30 分钟
- **状态机**：CLOSED → OPEN (3 failures) → HALF_OPEN (timeout) → CLOSED/OPEN
- **探测机制**：HALF_OPEN 状态允许 1 个任务探测，成功则恢复，失败则回到 OPEN
- **状态**：实现完成，支持自动转移和事件发出

### 3. 派发执行保护
- **重复派发检查**：追踪 activeProcesses Map，防止同一任务重复派发
- **资源检查**：CPU 负载、内存可用、Swap 使用率三重检查
- **动态座位分配**：MAX_SEATS 根据实际资源计算（最小 2 个）
- **HK MiniMax 路由**：特定 task_type 路由到香港执行器
- **状态**：实现完成

### 4. 派发流程多层检查
派发前依次检查 8 个关键点：
1. 排水模式
2. 计费暂停
3. 资源池预算
4. 电路熔断
5. 任务预检查（最多 5 次重试）
6. 任务状态更新
7. 执行器可用性
8. 服务器资源
→ 实现完成

### 5. 低成功率保护机制
- **设计**：完整，包括测试用例 (dispatch-low-rate.test.js)
- **检查条件**：`rate < 0.3 && total >= 10 && rate !== null`
- **实现状态**：设计完成，在 tick.js 派发流程中的检查点（0b 阶段）待实现
- **测试覆盖**：5 个场景均通过

### 6. 测试覆盖
- dispatch-stats.test.js：11 个测试，覆盖窗口边界、失败原因、DB 操作
- dispatch-low-rate.test.js：8 个测试，覆盖阈值判断
- circuit-breaker.test.js：7+ 个测试，覆盖三态转移
- 其他：dispatch-executor-fail, dispatch-preflight-skip 等

---

## 关键常数（事实来源）

### dispatch-stats.js（第 22-25 行）
```javascript
DISPATCH_STATS_KEY = 'dispatch_stats'        // DB key
WINDOW_MS = 3,600,000                        // 1 小时
DISPATCH_RATE_THRESHOLD = 0.3                // 30% 阈值
DISPATCH_MIN_SAMPLE = 10                     // 最小样本
```

### circuit-breaker.js（第 14-15 行）
```javascript
FAILURE_THRESHOLD = 3                        // 连续失败次数
OPEN_DURATION_MS = 1,800,000                 // 30 分钟冷却
```

### executor.js（第 29, 129-131 行）
```javascript
HK_MINIMAX_URL = 'http://100.86.118.99:5226' // HK 执行器 URL
MEM_PER_TASK_MB = 500                         // 每任务内存
CPU_PER_TASK = 0.5                            // 每任务 CPU
INTERACTIVE_RESERVE = 2                       // 预留座位
```

---

## 派发失败原因完整列表

| 原因码 | 来源 | 触发条件 | 恢复时间 | 行号 |
|--------|------|---------|---------|------|
| `draining` | tick.js | 排水模式激活 | 手动/告警 | 688 |
| `billing_pause` | tick.js | 计费上限 | 自动/手动 | 700 |
| `user_team_mode` | tick.js | 用户团队模式 | 用户切换 | 708 |
| `pool_exhausted` | tick.js | 资源池耗尽 | 自动补充 | 709 |
| `pool_c_full` | tick.js | C 类资源满 | 自动释放 | 709 |
| `circuit_breaker_open` | tick.js | 熔断器打开 | 30 分钟 + 成功 | 720 |
| `pre_flight_check_failed` | tick.js | 任务质量差 | 自动/隔离 | 761 |
| `no_executor` | tick.js | 执行器不可用 | 执行器恢复 | 797 |
| `task_not_found` | tick.js | 任务丢失 | DB 恢复 | 803 |
| `executor_failed` | tick.js | 执行失败 | 自动重试/隔离 | 820 |
| (无/成功) | tick.js | 派发成功 | N/A | 888 |

---

## 数据库存储

### working_memory 表 - dispatch_stats

```sql
SELECT * FROM working_memory WHERE key = 'dispatch_stats';

-- 返回 value_json 示例：
{
  "window_1h": {
    "total": 42,
    "success": 40,
    "failed": 2,
    "rate": 0.9523,
    "last_updated": "2026-02-19T10:30:00Z",
    "failure_reasons": {
      "circuit_breaker_open": 1,
      "pre_flight_check_failed": 1
    }
  },
  "events": [
    { "ts": "2026-02-19T10:30:00Z", "success": true },
    { "ts": "2026-02-19T10:29:55Z", "success": false, "reason": "circuit_breaker_open" },
    ...
  ]
}
```

---

## 关键函数速查

| 函数 | 文件 | 行号 | 用途 |
|------|------|------|------|
| `computeWindow1h()` | dispatch-stats.js | 65 | 计算 1 小时成功率统计 |
| `recordDispatchResult()` | dispatch-stats.js | 97 | 记录派发结果 |
| `getDispatchStats()` | dispatch-stats.js | 135 | 获取当前统计（API 用） |
| `isAllowed()` | circuit-breaker.js | 48 | 检查派发是否被允许 |
| `recordFailure()` | circuit-breaker.js | 78 | 记录失败，触发熔断 |
| `recordSuccess()` | circuit-breaker.js | 61 | 记录成功，恢复熔断 |
| `checkServerResources()` | executor.js | 180 | 检查服务器资源 |
| `triggerCeceliaRun()` | executor.js | 1051 | 派发任务到执行器 |
| `triggerMiniMaxExecutor()` | executor.js | 982 | 派发到 HK MiniMax |
| `dispatchNextTask()` | tick.js | 679 | 派发流程主函数 |

---

## 设计决策与考量

### 1. 为什么是 1 小时滚动窗口？
- 避免长期历史数据的干扰
- 快速响应最近趋势变化
- 与告警等级调整的时间尺度一致

### 2. 为什么最小样本是 10？
- 防止小样本偏差（如 1/2 = 50% 不代表真实趋势）
- 提供统计意义上的可信度
- 与派发频率（5 分钟一次）匹配

### 3. 为什么成功率阈值是 30%？
- 严格保护：< 30% 意味着系统严重故障（70% 失败）
- 与三层告警体系集成
- 给系统留出足够的自恢复空间

### 4. 为什么熔断冷却是 30 分钟？
- 给系统充足的恢复时间
- 避免频繁 OPEN/HALF_OPEN 切换
- 与日常运维节奏匹配

### 5. 为什么派发有 11 种失败原因？
- 区分可恢复和不可恢复的故障
- 便于告警和自动响应
- 支持细粒度的故障分析

---

## 探索方法论

本次探索使用以下方法：

1. **代码阅读**：从入口点逐层深入
   - tick.js dispatchNextTask() → 派发流程入口
   - executor.js triggerCeceliaRun() → 执行层
   - dispatch-stats.js recordDispatchResult() → 监控层
   - circuit-breaker.js isAllowed() → 保护层

2. **事实来源识别**：
   - 所有常数从源代码提取（非文档）
   - 所有函数定义及行号精确定位
   - 所有数据结构从实际代码获取

3. **测试驱动验证**：
   - 通过测试文件验证设计意图
   - 确认边界条件和异常处理
   - 评估测试覆盖度

4. **集成点分析**：
   - 追踪 import/export 关系
   - 识别组件间的调用链
   - 绘制完整的控制流

---

## 后续工作建议

### 优先级 P0
1. 在 tick.js 第 720 行（circuit_breaker_open 检查后）实现低成功率检查（0b 阶段）
2. 补充 API 端点：`GET /api/brain/dispatch-stats` 直接获取统计

### 优先级 P1
1. 添加派发统计的可视化 Dashboard（Workspace 前端）
2. 实现 dispatch_stats 的自动告警规则
3. 支持动态调整阈值（DISPATCH_RATE_THRESHOLD, DISPATCH_MIN_SAMPLE）

### 优先级 P2
1. 分离派发失败原因到 enum（避免字符串魔数）
2. 添加派发统计的导出/备份功能
3. 实现派发成功率历史追踪（时间序列）

---

## 文件清单

```
/home/xx/perfect21/cecelia/core/
├── DISPATCH_EXPLORATION_INDEX.md (本文件)
├── DISPATCH_EXPLORATION.md (深度分析，567 行)
├── DISPATCH_QUICK_REFERENCE.md (快速查询，294 行)
├── CODE_SNIPPETS_DISPATCH.md (代码参考，494 行)
└── brain/src/
    ├── dispatch-stats.js (147 行)
    ├── circuit-breaker.js (138 行)
    ├── executor.js (1571 行)
    ├── tick.js (1200+ 行)
    ├── pre-flight-check.js
    ├── slot-allocator.js
    └── __tests__/
        ├── dispatch-stats.test.js
        ├── dispatch-low-rate.test.js
        ├── circuit-breaker.test.js
        ├── dispatch-executor-fail.test.js
        └── dispatch-preflight-skip.test.js
```

---

## 如何使用本文档

1. **第一次接触派发系统**
   → 先读 DISPATCH_EXPLORATION.md 的摘要和第 1-2 章

2. **需要定位代码快速**
   → 用 DISPATCH_QUICK_REFERENCE.md 的文件位置速查

3. **学习具体实现**
   → 参考 CODE_SNIPPETS_DISPATCH.md 的代码片段

4. **排查派发问题**
   → 按 DISPATCH_QUICK_REFERENCE.md 的常见排查步骤操作

5. **深度理解整个系统**
   → 精读 DISPATCH_EXPLORATION.md 的所有章节

---

## 版本信息

- 生成日期：2026-02-19
- 代码库分支：cp-02191039-165259f4-9afb-404c-a299-ce8503
- 代码库最新提交：0495b80 (v1.50.3)
- 探索工具：Anthropic Claude Code
- 探索模式：只读分析，无代码修改

---

## 联系和反馈

如发现本文档与代码不符（代码是事实来源），请立即报告。

所有行号、函数名、常数值都应与源代码精确对应。
