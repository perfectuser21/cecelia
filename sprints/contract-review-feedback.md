# Contract Review Feedback (Round 1)

> reviewer_task_id: 9f4a5712-4fdb-4ffd-8a69-88d189e08f64
> propose_task_id: 73c7a6be-03a8-498b-be49-fecf8d5afaf4
> planner_task_id: dbf2ec0d-dcb9-4cee-9724-8591c13305dd
> verdict: REVISION
> round: 1

**审查草案来源**: cp-04082030-7e6f21ac 分支（proposer 73c7a6be 未留下可寻找的草案，使用同主题最近草案审查）

---

## 必须修改项

### 1. [PRD 遗漏] PRD Feature 2（单元测试覆盖）在合同中完全缺失

**问题**: PRD 明确要求"存在专门测试 verdict=null fallback 场景的测试用例"，且测试必须验证 Reviewer 任务创建函数被调用、warn 日志被输出。合同草案 Feature 1 和 Feature 2 全是静态 node -e 文件读取，**没有任何 npm test / unit test 验证命令**。

**影响**: 实现者可以写一个正确的静态代码，但 fallback 分支的实际逻辑完全没有被测试覆盖。一个有 bug 的运行时行为（如 fallback 分支被条件跳过）无法被当前命令检测到。

**建议修复**:
```bash
# 验证单元测试文件存在且覆盖 verdict=null 场景
node -e "
  const fs = require('fs');
  const testFiles = ['packages/brain/src/__tests__/execution.test.js',
                     'packages/brain/src/routes/__tests__/execution.test.js'];
  const found = testFiles.find(f => { try { return fs.statSync(f).isFile(); } catch(e){ return false; } });
  if (!found) { console.error('FAIL: 未找到 execution 测试文件'); process.exit(1); }
  const src = fs.readFileSync(found, 'utf8');
  if (!src.includes('fallback') && !src.includes('verdict=null') && !src.includes('PROPOSED')) {
    console.error('FAIL: 测试文件未覆盖 verdict=null fallback 场景'); process.exit(1);
  }
  console.log('PASS: 找到覆盖 fallback 场景的测试文件:', found);
"
```

---

### 2. [PRD 遗漏] PRD Feature 3（端到端链路验证）在合同中缺失

**问题**: PRD Feature 3 明确要求"在 Brain DB 中模拟一个已完成（status=completed）的 harness_contract_propose 任务（result 不含 PROPOSED 关键字），触发 execution-callback 后，Brain 数据库中能查到新创建的 harness_contract_review 任务"。合同草案完全没有模拟触发场景——只检查代码存在性，不验证运行时链路。

**影响**: fallback 逻辑可能因某些条件（如 result 格式、status 判断）在特定场景下不触发，而所有静态检查都会 PASS。这是最重要的测试场景，却完全缺失。

**建议修复**:
```bash
# 端到端验证：插入 verdict=null 任务 → 触发 execution callback → 验证 R1 被创建
BEFORE_COUNT=$(curl -sf "localhost:5221/api/brain/tasks?task_type=harness_contract_review&limit=100" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).length))")
# 模拟触发（通过 Brain 测试端点或直接 curl execution-callback）
# 注意：实际端到端测试需要模拟 propose 任务完成回调
echo "INFO: 端到端验证需要配合 Brain 测试端点或集成测试实现"
```

---

### 3. [有硬编码占位符] Feature 2 验证命令硬编码了特定 propose_task_id，无法复用

**问题**: 合同草案 Feature 2 验证命令中：
```bash
PROPOSE_ID="7e6f21ac-4554-4d53-bb5f-e4607a917ede"
```
这个 ID 是当前 proposer 的特定 task ID，**在任何其他 sprint run 都无法使用**。这等同于一个 `{task_id}` 占位符——Evaluator 无法无脑执行，必须手动替换。

**影响**: 每次新 sprint 运行，Evaluator 必须手动编辑命令替换 PROPOSE_ID，违反"无脑执行"原则。

**建议修复**: 使用实际注入的变量 `$PROPOSE_TASK_ID`（来自 harness 运行时注入），或查询 planner_task_id 关联的最新 propose 任务：
```bash
# 正确做法：用 planner_task_id 查询（而非硬编码 propose_task_id）
PLANNER_ID="dbf2ec0d-dcb9-4cee-9724-8591c13305dd"
RESULT=$(curl -sf "localhost:5221/api/brain/tasks?task_type=harness_contract_review&limit=20")
COUNT=$(echo "$RESULT" | node -e "
  const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(tasks.filter(t => t.payload?.planner_task_id === '$PLANNER_ID').length);
" 2>/dev/null || echo "0")
if [ "$COUNT" -gt "0" ]; then echo "PASS: 找到 $COUNT 个 R1 任务"; else echo "FAIL: 未找到对应 R1 任务"; exit 1; fi
```

---

### 4. [命令非致命] Feature 2 验证 2 失败路径标记为"非致命"，无法给出 FAIL 信号

**问题**: 当前命令：
```bash
  echo "INFO: harness_contract_review 任务尚未创建（可能 propose 仍在进行中）"
  # 非致命——propose 完成后 Brain tick 会自动创建
```
命令在 COUNT=0 时输出 INFO 并**以 exit 0 退出**，不报错。

**影响**: Evaluator 无法区分"测试通过"和"测试失败"。一个完全没有创建 R1 任务的错误实现，Evaluator 跑完这个命令也会看到 exit 0。

**建议修复**: 当 propose 任务已完成时，R1 任务必须存在，否则 `exit 1`（如上面 Issue 3 的修复命令所示）。

---

### 5. [命令弱验证] Feature 1 验证 2 仅检查字符串距离（3000字符），不验证代码逻辑关联

**问题**:
```javascript
if (Math.abs(propIdx - reviewIdx) > 3000) { ... FAIL ... }
```
用字符偏移距离来判断两段代码"在同一分支"是极弱的启发式验证。execution.js 有 2000+ 行，任意两个字符串可能偶然在 3000 字符内，也可能不在——与逻辑关联无关。

**影响**: 假实现可以在文件头部写一个注释 `// fallback→PROPOSED` 并在附近写 `// harness_contract_review`，命令就会 PASS。

**建议修复**: 直接读取并验证代码块的结构逻辑，而不是字符偏移：
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  // 验证 fallback 后面紧跟 proposeVerdict = 'PROPOSED' 赋值（实际行为，非注释）
  if (!c.match(/if\s*\(!proposeVerdict\)[^}]*proposeVerdict\s*=\s*'PROPOSED'/s)) {
    console.error('FAIL: 未找到 if(!proposeVerdict)→proposeVerdict=PROPOSED 赋值逻辑');
    process.exit(1);
  }
  console.log('PASS: fallback 赋值逻辑存在');
"
```

---

## 可选改进

- Feature 1 验证 1 中 `c.includes('fallback→PROPOSED')` 会被注释蒙混，建议改为检查 `warn(` 函数调用而非字符串包含
- 可增加 `psql` 验证：确认 Brain DB 中实际创建了 `harness_contract_review` 任务（比 curl API 更直接）
- 建议明确说明"当 propose task 已完成时，R1 必须已存在"——当前合同将 R1 存在标记为非致命是错误的

---

**结论**: 合同存在 2 个 PRD 遗漏（Feature 2 单元测试 + Feature 3 端到端）、1 个硬编码占位符、1 个非致命退出逻辑、1 个弱验证命令。必须修改后重新提交。
