# 合同审查反馈（第 1 轮）

> reviewer_round: 1
> verdict: REVISION
> issues_count: 7

---

## 必须修改

### 1. [PRD 遗漏] Feature 2（告警日志格式标准化）完全缺失
PRD 明确定义了 Feature 2：告警日志需含任务 ID、任务标题、已等待分钟数，且可通过 `grep [WARN][stuck-task]` 快速筛选。合同草案对此无任何验收命令。Generator 实现时无参照，且无验证路径。

**要求**：必须为 Feature 2 增加独立的验收标准和验证命令。

---

### 2. [格式不一致] 日志前缀与 PRD 冲突
PRD Feature 2 要求格式标签为 `[WARN][stuck-task]`，合同草案阈值 1 和阈值 2 检查的是 `[STUCK-ALERT]`。两者不一致，Generator 会产生歧义导致实现错误。

**要求**：以 PRD 为准，统一日志前缀为 `[WARN][stuck-task]`，并更新所有验证命令。

---

### 3. [命令太弱] 阈值 2 `hasStatus` 检查过度宽泛
```js
const hasStatus = src.includes("status = 'queued'") || src.includes('status=\'queued\'') || src.includes('queued');
```
最后一个 `src.includes('queued')` 匹配任何包含 "queued" 字样的文件（任务状态字段名、注释、字符串常量等均触发），无法证明正确的 `status='queued'` 过滤条件存在。一个空函数配一条 `// queued` 注释就能蒙混过关。

**要求**：删除宽泛的 `includes('queued')` 兜底，改为精确匹配 `"status = 'queued'"` 或 `"status='queued'"`。

---

### 4. [缺失关键测试] 无运行时验证——全部 4 条阈值均为静态检查
4 条阈值全是源码字符串扫描 + 裸 psql 查询，没有任何一条命令实际运行 tick.js 中的检测逻辑。一个包含正确关键字但逻辑完全错误的实现（如：函数存在但永远不被调用）可以通过全部 4 条阈值。

**要求**：增加至少 1 条运行时验证，直接调用 tick.js 中的 stuck 检测函数并验证日志输出。参考方向：
```bash
# 插入超时任务 → 运行检测函数 → 验证 stdout 含正确日志格式
node -e "
  process.env.NODE_ENV='test';
  const { checkStuckP1Tasks } = require('./packages/brain/src/tick.js');
  // 或调用 tick 模块暴露的检测接口
  checkStuckP1Tasks().then(logs => {
    if (!logs || !logs.some(l => l.includes('[WARN][stuck-task]'))) process.exit(1);
  });
"
```
（具体导出方式依实现调整，但必须有运行时调用路径）

---

### 5. [阈值 3 不测应用层] DB 测试只验证 SQL，不验证 tick.js 行为
阈值 3 通过 psql 直接插入任务并用 SQL 查询验证能找到数据。这只证明"原始 SQL 查询语义正确"，不能证明 tick.js 的检测函数会被调用并产生日志输出。Generator 可以不在 tick.js 中实现任何逻辑，阈值 3 依然通过。

**要求**：阈值 3 改为：插入超时任务 → 触发 tick.js 检测函数 → 验证日志含该任务 ID。

---

### 6. [假测边界] 阈值 4 声称验证"不误报"，实际不测 tick.js 行为
```bash
psql cecelia -c "SELECT COUNT(*) FROM tasks WHERE ..." | grep -E "^\s+[0-9]+"
```
这条命令只验证 psql 查询能执行并返回数字，与"tick.js 不输出误报告警"没有任何关系。即使 tick.js 对不超时的任务也输出告警，该命令依然通过。

**要求**：阈值 4 改为：插入一个未超时的 P1 queued 任务（queued 15 分钟）→ 触发检测函数 → 验证 stdout **不含** `[WARN][stuck-task]` 该任务 ID。

---

### 7. [缺失持续告警验证] PRD 明确要求"每次 tick 均持续告警"，合同无对应测试
PRD 验收标准原文：
> 同一任务在每次 tick 检查时均输出告警（持续告警，直到任务被处理）

合同草案没有任何命令验证检测函数是否为持续调用设计（例如：是否有"已告警过则跳过"的错误实现）。

**要求**：增加测试：连续调用检测函数两次，验证两次均输出该任务的 `[WARN][stuck-task]` 日志（即无去重/静音逻辑）。

---

## 可选改进

- 阈值 1 检查 `'30'` 过于宽泛（匹配任何含 "30" 的字符串，如注释、其他变量）；改为检查 `'30 minutes'` 或 `"INTERVAL '30"` 更精确
- Feature 2 验证可增加：`grep -c '\[WARN\]\[stuck-task\]' <log_file>` 验证格式可被运维检索（但需确保 log 文件路径可预测）
- 阈值 3 清理测试数据的 DELETE 语句应放在 trap 里，防止测试失败时数据残留
