# 合同审查反馈（第 1 轮）

verdict: REVISION
issues_count: 4

---

## 必须修改

### 1. [阈值严重低估] 计数下界"≥ 1 处"与实际不符

**原文**：`数量 ≥ 现有 console.log 数量（≥ 1 处）`

**问题**：`packages/brain/src/tick.js` 当前实际有 **106** 个 `console.log` 调用。括号内写"≥ 1 处"会让实现者/Evaluator 认为最低满足 1 处即达标。前半句虽说"所有调用均必须"，但括号阈值与实际数量形成矛盾，Evaluator 无法用数量指标独立验证全量覆盖。

**要求改为**：
```
tick.js 中所有 console.log(...) 调用均必须输出带前缀的内容，
数量严格等于改前的 console.log 总数（当前基准：106 处）
```

并提供验证命令：
```
manual:node -e "const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); const n=(src.match(/console\.log/g)||[]).length; if(n>0){throw new Error('仍有未替换的 console.log: '+n)}"
```
（若 tickLog 替换完毕，原始 `console.log` 调用数应为 0）

---

### 2. [验证命令缺失] "Evaluator 用任意方式验证"不是可执行标准

**原文**：`验收判断：Evaluator 用任意方式验证以上行为是否成立`

**问题**：这是一句元描述，不是合同条款。106 个替换点是否全部完成、时区是否确实是 UTC+8、非 tick 模块是否不受影响——三项均无具体验证命令。Evaluator 只能手工阅读代码，无法自动化。

**要求补充以下三条具体验证命令**：

（A）格式验证 — tickLog 输出是否匹配 regex：
```
manual:node -e "
const {execSync}=require('child_process');
const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8');
if(!src.includes('tickLog')){throw new Error('tickLog 函数未定义')}
if(!src.includes('Asia/Shanghai')){throw new Error('时区未设为 Asia/Shanghai')}
"
```

（B）全量替换验证 — 原 console.log 是否全部消除：
```
manual:node -e "
const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8');
const remaining=(src.match(/(?<!tickLog[\s\S]{0,20})console\.log/g)||[]).length;
if(remaining>0){throw new Error('仍有 '+remaining+' 处未替换的 console.log')}
"
```

（C）非 tick 模块隔离验证 — server.js 中无 tickLog 调用：
```
manual:node -e "
const src=require('fs').readFileSync('packages/brain/src/server.js','utf8');
if(src.includes('tickLog(')){throw new Error('server.js 不应调用 tickLog')}
"
```

---

### 3. [边界情况无验证路径] 多行日志和时区验证缺乏可测试场景

**问题**：
- 多行日志"只在第一行加前缀"：没有说明触发场景，Evaluator 无法验证
- 时区"≤ 2 秒误差"：没有说明如何在不启动完整 Brain 服务的前提下验证

**要求**：
- 若多行日志处理是要求的，给出可触发多行 log 的具体测试代码
- 时区验证改为：
```
manual:node -e "
const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8');
if(!src.includes(\"timeZone:'Asia/Shanghai'\") && !src.includes('timeZone: \\'Asia/Shanghai\\'') && !src.includes('Asia/Shanghai')){
  throw new Error('tickLog 未使用 Asia/Shanghai 时区')
}"
```

---

### 4. [超出 PRD 范围] 多行日志处理未经 PRD 确认

**原文**：`当日志内容本身含换行符时，只在第一行前加时间戳前缀（不对子行重复添加）`

**问题**：PRD 未提及此要求。合同单方面增加了此行为约束。若实现未处理，Evaluator 是否有权以此为由判定失败？此处有歧义。

**要求二选一**：
- 若确认此为需求：在合同中明确说明"此为扩展行为，Generator 须实现，Evaluator 验收时按此标准"
- 若不确认：从合同中删除此条，避免边界歧义

---

## 可选改进

- 在"技术实现方向"中补充：若 `console.log` 被调用时传入 `Error` 对象，`tickLog` 如何处理（toString 还是透传？）
- 在"不在本次范围内"明确：**不要求**启动完整 Brain 服务来验证，所有验证命令必须在 CI 环境（无 PostgreSQL、无 5221 端口）下可执行

---

## 总结

本草案行为方向正确、结构清晰，主要问题集中在**验证可操作性**上：
1. 计数下界严重低估（1 vs 106）
2. 无具体验证命令
3. 两个边界情况无验证路径

Generator 修改后重新提交第 2 轮草案即可通过。
