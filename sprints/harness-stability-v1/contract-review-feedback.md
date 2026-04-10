# Contract Review Feedback (Round 1)

## Triple 分析摘要

- 总命令数: 15
- 覆盖分析数: 15 (100%)
- can_bypass: Y 数量: 12 (80%) — **严重，绝大多数命令可被假实现蒙混**

## 必须修改项

### 1. [命令会报错] WS1-D1 — require() CLI 脚本不导出 ALLOWED_COMMANDS

**原始命令**:
```bash
node -e "const m=require('./scripts/devgate/check-manual-cmd-whitelist.cjs');if(!m.ALLOWED_COMMANDS.has('playwright'))process.exit(1);console.log('OK')"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 不需要假实现——命令本身就会失败
// check-manual-cmd-whitelist.cjs 是 CLI 工具，require() 时执行 main()
// main() 读 process.argv[2] 为 undefined → readFileSync(undefined) → 报错 exit(1)
// 即使实现正确也永远 FAIL
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs', 'utf8');
  if (!c.includes(\"'playwright'\") && !c.includes('\"playwright\"')) {
    console.log('FAIL: ALLOWED_COMMANDS 中未找到 playwright');
    process.exit(1);
  }
  console.log('PASS: ALLOWED_COMMANDS 包含 playwright');
"
```

### 2. [命令太弱] F3-C1/F3-C2/F3-C3 + WS3 全部 — 纯文本 includes() 无行为验证

**原始命令**（F3-C3 示例）:
```bash
node -e "...if(c.includes('REPORT_FAILED')&&c.includes('3')){ok=true;break}..."
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：在 brain/src/任意文件中加一行注释即可通过所有 F3 验证
// packages/brain/src/tick.js:
// TODO: harness_report retry 3 times, output REPORT_FAILED on failure （注释，死代码）

// 命令 includes('REPORT_FAILED') → true, includes('3') → true, includes('retry') → true
// 但没有任何实际重试逻辑
```

**建议修复命令**:
```bash
# WS3-D2 修复：验证实际代码结构而非纯文本存在
node -e "
  const fs = require('fs');
  const path = require('path');
  let found = false;
  for (const f of fs.readdirSync('packages/brain/src').filter(x => x.endsWith('.js'))) {
    const c = fs.readFileSync(path.join('packages/brain/src', f), 'utf8');
    // 必须在非注释行中同时出现 retry 相关代码模式
    const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const code = lines.join('\n');
    if (code.includes('harness_report') && code.includes('max_retries') && code.includes('REPORT_FAILED')) {
      found = true; break;
    }
  }
  if (!found) { console.log('FAIL: Brain 代码中未找到非注释的重试逻辑'); process.exit(1); }
  console.log('PASS');
"

# WS3-D3 修复：验证 max_retries 的值确实是 3
node -e "
  const fs = require('fs');
  const path = require('path');
  let found = false;
  for (const f of fs.readdirSync('packages/brain/src').filter(x => x.endsWith('.js'))) {
    const c = fs.readFileSync(path.join('packages/brain/src', f), 'utf8');
    // 匹配 max_retries = 3 或 maxRetries: 3 等赋值模式
    if (/max.?retries\s*[:=]\s*3/i.test(c) && c.includes('REPORT_FAILED')) {
      found = true; break;
    }
  }
  if (!found) { console.log('FAIL: 未找到 max_retries=3 + REPORT_FAILED 的赋值'); process.exit(1); }
  console.log('PASS');
"
```

### 3. [命令太弱] WS2-D2/WS2-D3 — includes() 可被注释蒙混

**原始命令**:
```bash
node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessListPage.tsx','utf8');if(!c.includes('harness_planner'))process.exit(1);console.log('OK')"
```

**假实现片段**（proof-of-falsification）:
```tsx
// 假实现：HarnessListPage.tsx 只包含一行注释
// harness_planner task_type=harness status
// 命令 includes('harness_planner') → true, includes('task_type=harness') → true, includes('status') → true
// 但页面实际是空白组件
export default function HarnessListPage() { return <div />; }
```

**建议修复命令**:
```bash
# WS2-D2 修复：验证组件包含实际的 API 调用代码（fetch/axios/useSWR），而非注释
node -e "
  const c = require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessListPage.tsx', 'utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const code = lines.join('\n');
  if (!code.includes('harness_planner')) { console.log('FAIL: 非注释代码中无 harness_planner'); process.exit(1); }
  if (!/fetch|axios|useSWR|useQuery/.test(code)) { console.log('FAIL: 无 API 调用代码'); process.exit(1); }
  console.log('PASS');
"

# WS2-D3 修复：验证渲染了列表项（map/forEach）且展示 status
node -e "
  const c = require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessListPage.tsx', 'utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('//'));
  const code = lines.join('\n');
  if (!/\.map\s*\(/.test(code)) { console.log('FAIL: 未找到列表渲染（.map）'); process.exit(1); }
  if (!code.includes('status')) { console.log('FAIL: 未渲染 status 字段'); process.exit(1); }
  console.log('PASS');
"
```

### 4. [命令太弱] WS2-D1 — 空目录即可过

**原始命令**:
```bash
node -e "require('fs').accessSync('apps/dashboard/src/pages/harness');console.log('OK')"
```

**假实现片段**（proof-of-falsification）:
```bash
# 假实现：mkdir -p apps/dashboard/src/pages/harness （空目录，无任何组件文件）
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const dir = 'apps/dashboard/src/pages/harness';
  if (!fs.existsSync(dir)) { console.log('FAIL: 目录不存在'); process.exit(1); }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));
  if (files.length === 0) { console.log('FAIL: 目录中无 .tsx/.ts 文件'); process.exit(1); }
  console.log('PASS: 目录包含 ' + files.length + ' 个组件文件');
"
```

### 5. [命令太弱] F1-C1 — 同 WS2-D1，空目录即可过

**原始命令**:
```bash
node -e "const fs=require('fs'); const dir='apps/dashboard/src/pages/harness'; if(!fs.existsSync(dir))throw...; const files=fs.readdirSync(dir); if(files.length===0) throw..."
```

**假实现片段**（proof-of-falsification）:
```bash
# 假实现：mkdir -p apps/dashboard/src/pages/harness && touch apps/dashboard/src/pages/harness/.gitkeep
# files.length = 1，通过检查。但没有任何有效组件。
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const dir = 'apps/dashboard/src/pages/harness';
  if (!fs.existsSync(dir)) throw new Error('FAIL: harness 目录不存在');
  const tsxFiles = fs.readdirSync(dir).filter(f => /\.(tsx?|jsx?)$/.test(f));
  if (tsxFiles.length === 0) throw new Error('FAIL: harness 目录无组件文件（.tsx/.ts）');
  // 验证至少一个文件大于 50 字节（非空壳）
  for (const f of tsxFiles) {
    const stat = fs.statSync(require('path').join(dir, f));
    if (stat.size > 50) { console.log('PASS: ' + f + ' (' + stat.size + ' bytes)'); process.exit(0); }
  }
  throw new Error('FAIL: 所有组件文件均小于 50 字节');
"
```

### 6. [命令太弱] F1-C3 — includes('/harness') 可被注释蒙混 + 使用了 find 命令

**原始命令**:
```bash
node -e "...const allFiles = require('child_process').execSync('find ' + appDir + ' -name ...').toString()..."
```

**假实现片段**（proof-of-falsification）:
```tsx
// 假实现：在任意已有 dashboard 文件中加一行注释
// // TODO: add /harness route for Harness panel
// includes('/harness') → true，但无实际路由注册
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const path = require('path');
  // 检查 App.tsx 或 routes 配置文件中包含 /harness 路由
  const candidates = ['apps/dashboard/src/App.tsx', 'apps/dashboard/src/routes.tsx', 'apps/dashboard/src/router.tsx'];
  let found = false;
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.trim().startsWith('//'));
    if (lines.join('\n').includes('/harness')) { found = true; console.log('PASS: ' + f + ' 注册了 /harness 路由'); break; }
  }
  // 兜底：递归扫描（不用 find，用 Node API）
  if (!found) {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
        if (e.isDirectory() && e.name !== 'node_modules') walk(path.join(dir, e.name));
        else if (/\.(tsx?)$/.test(e.name)) {
          const c = fs.readFileSync(path.join(dir, e.name), 'utf8');
          const lines = c.split('\n').filter(l => !l.trim().startsWith('//'));
          if (lines.join('\n').includes(\"path:') && lines.join('\n').includes('/harness'\")) { found = true; return; }
        }
      }
    };
    walk('apps/dashboard/src');
  }
  if (!found) { console.log('FAIL: 未找到 /harness 路由注册'); process.exit(1); }
"
```

### 7. [PRD 遗漏] Feature 1 缺少 GAN 轮次 + 阶段信息的验证命令

PRD 明确要求：*"面板展示 sprint 列表，每个 sprint 显示当前阶段（Planner / Proposer / Reviewer / Generator / Evaluator / Report）、GAN 轮次"*

合同只验证了 title 和 status，**未验证阶段（phase/stage）和 GAN 轮次（gan_round）的展示**。

**建议修复**: 在 WS2 DoD 或 Feature 1 验证命令中增加对 phase/stage/round 字段的渲染验证。

### 8. [缺失边界] Feature 3 缺少递增间隔行为验证

PRD 要求 *"每次间隔递增（如 5s → 15s → 30s）"*，但所有验证命令只检查 `retry` 字符串存在，**未验证间隔递增行为**。

**建议修复**: 增加代码模式验证，确认间隔值是递增序列：
```bash
node -e "
  const fs = require('fs');
  const path = require('path');
  for (const f of fs.readdirSync('packages/brain/src').filter(x => x.endsWith('.js'))) {
    const c = fs.readFileSync(path.join('packages/brain/src', f), 'utf8');
    // 寻找递增间隔模式：数组如 [5000, 15000, 30000] 或乘法递增
    if (/\[\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\]/.test(c) && c.includes('retry')) {
      console.log('PASS: 找到递增间隔数组'); process.exit(0);
    }
    if (/delay\s*\*=?\s*\d/.test(c) && c.includes('retry')) {
      console.log('PASS: 找到递增间隔乘法模式'); process.exit(0);
    }
  }
  console.log('FAIL: 未找到递增间隔模式'); process.exit(1);
"
```

## 可选改进

- Feature 2 可增加边界测试：`manual:npx cat /etc/passwd` 应该被放行（npx 在白名单）还是被拦截？当前逻辑只检查第一个词，如果 `npx` 在白名单则 `npx <anything>` 都通过——这可能是预期行为，但值得在合同中明确。
- Feature 1 的 F1-C2（curl Brain API）依赖 Brain 运行中——在 CI 环境可能不可用。建议标注为 `manual:` 类型测试或确认 CI 环境有 Brain 服务。
