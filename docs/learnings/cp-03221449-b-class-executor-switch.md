# Learning: B类任务 Executor 切换 (cp-03222206)

## 根本原因

### 问题1: self-drive.test.js 括号不平衡（PR #1275 引入）
PR #1275 在 `runSelfDrive` describe 块末尾多添了一个 `});`，导致两个新的 `it` 块被推到了 describe 作用域之外。  
Vite/acorn 解析到文件末尾出现多余的 `}` 时报 `Unexpected token '}'`，所有 brain 测试文件都无法运行。

### 问题2: planner-scope.test.js mock 队列污染
`vi.clearAllMocks()` 只清空调用记录，**不清空 `mockResolvedValueOnce` 队列**。  
前一个 test 残留的 once-value 被下一个 test 消费，mock 行为错乱。

### 问题3: learning-effectiveness.test.js FK 清理覆盖范围过宽
在 `beforeEach` 添加了 `DELETE FROM failure_events` / `dispatch_events` 等表，  
这些表在 CI 的 fresh DB 中不存在 → `relation "failure_events" does not exist` → 8 个测试失败。

## 下次预防

- [ ] 改测试文件后，用 `node --input-type=module < file.js` 验证语法，再提交
- [ ] mock 隔离一律用 `vi.resetAllMocks()`，而非 `vi.clearAllMocks()`
- [ ] 在 `beforeEach` 里加 `DELETE FROM` 前，先确认该表在 CI schema 中存在（`\dt` 核查）
- [ ] brain-test-baseline.txt 随修复同步更新，不允许 baseline 积累超过修复速度
