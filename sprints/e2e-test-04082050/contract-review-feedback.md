# 合同审查反馈（第 1 轮）

## 必须修改

### 1. [格式冲突] PRD vs 合同草案的时间戳格式不一致

- **PRD 要求**：`[HH:MM:SS]`，示例 `[14:32:07] tick: executing actions...`
- **合同草案要求**：`[TICK \d{2}:\d{2}:\d{2}]`，格式为 `[TICK 14:32:07]`
- **问题**：两者不一致。合同草案在方括号内添加了 `TICK ` 前缀，PRD 没有这个要求。实现者按 PRD 做 `[HH:MM:SS]` 格式，Evaluator 用合同的 `[TICK` 正则验证会 100% 失败。
- **修复**：合同必须和 PRD 格式对齐，硬阈值应为 `^\[\d{2}:\d{2}:\d{2}\]`，而非 `^\[TICK \d{2}:\d{2}:\d{2}\]`。

### 2. [无可执行命令] 验证方式全是描述性文字，无法直接执行

当前验证方式：
- "读取源代码，确认每个 console.log 字符串参数以 [TICK 开头" — 不是命令
- "在运行时抓取输出，用正则匹配，通过率须为 100%" — 不是命令

**问题**：Evaluator 无法"无脑执行"这些步骤，没有任何 shell 命令，没有 exit code 语义（成功=0，失败=非零）。必须提供实际可运行的命令。

**修复示例**：
```bash
# 静态检查：tick.js 中是否有时间戳注入逻辑
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/tick.js', 'utf8');
if (!src.includes('HH:MM:SS') && !src.match(/\d{2}:\d{2}:\d{2}/)) {
  console.error('未找到时间戳格式'); process.exit(1);
}
console.log('静态检查通过');
"
```

### 3. [缺少时区验证] PRD 明确要求上海时区，合同未验证

- PRD 成功标准：`24小时制，上海时区`
- 合同草案：完全没有验证时区

**问题**：如果实现者用 UTC 或本地时区，验证命令无法检测到错误。

**修复**：增加验证命令，确认代码中使用 `Asia/Shanghai` 时区或 `TZ=Asia/Shanghai` 处理时间。

### 4. [无负向测试] 未验证非 tick 模块不受影响

- PRD 成功标准 3：非 tick.js 模块的日志输出不受影响
- 合同草案：硬阈值 4 有文字描述，但无对应验证命令

**修复**：增加命令验证 `packages/brain/src/server.js` 等其他模块的日志调用不含时间戳前缀注入逻辑。

### 5. [命令弱验证] 缺少静态代码分析命令的具体实现

当前合同说"确认每个 console.log 字符串参数以 [TICK 开头"，但：
- 如果实现是 `const ts = getTime(); console.log(\`${ts} tick: ...\`)` — 格式可能正确但字符串不以 `[TICK` 开头
- 正确的静态检查应该验证是否有时间戳注入函数，而不是检查字符串字面量

---

## 可选改进

- 合同可以增加一个运行时验证命令（如通过日志文件或 curl 触发一次 tick 后检查输出）
- 可以用 `npm test` 引用 `packages/brain/src/__tests__/tick.test.js`（如果存在）来做单元测试验证
- 明确指定"上海时区"的验证方式（`TZ=Asia/Shanghai node -e "console.log(new Date().toLocaleTimeString('zh-CN', {hour12: false, timeZone: 'Asia/Shanghai'}))")`）

---

**结论**：合同草案存在格式与 PRD 根本冲突（P0）+ 无任何可执行命令（P0），必须修改后重新提交。
