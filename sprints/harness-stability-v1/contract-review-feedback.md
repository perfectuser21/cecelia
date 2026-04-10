# Contract Review Feedback (Round 4)

## Triple 分析摘要

- 总命令数: 10
- Triple 覆盖: 10/10 (100%)
- can_bypass: Y = 5 条 (F1-C1, F1-C2, F1-C3, F3-C1, F3-C3)
- 实质性问题: 1 条 (F3-C3)
- 被其他命令覆盖的弱命令: 3 条 (F1-C1→F1-C3, F1-C2→F1-C3, F3-C1→F3-C2)

## 必须修改项

### 1. [命令太弱] Feature 3 — F3-C3 递增间隔不验证实际递增

**原始命令**:
```bash
node -e "... /\[\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\]/.test(code) && /retry|REPORT_FAILED/i.test(code) ..."
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：等间隔（非递增）也能通过
const RETRY_DELAYS = [5000, 5000, 5000]; // retry
const REPORT_FAILED = 'REPORT_FAILED';
// 命令只检查 [N,N,N] 格式存在 + retry/REPORT_FAILED 关键词
// 但 [5000,5000,5000] 不是递增的，违反 PRD "每次间隔递增" 要求
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const path = require('path');
  const walk = (dir) => {
    const r = [];
    for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '__tests__') walk(full).forEach(f => r.push(f));
      else if (e.name.endsWith('.js')) r.push(full);
    }
    return r;
  };
  for (const f of walk('packages/brain/src')) {
    const c = fs.readFileSync(f, 'utf8');
    const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const code = lines.join('\n');
    const m = code.match(/\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/);
    if (m && /retry|REPORT_FAILED/i.test(code)) {
      const [a, b, c2] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (a < b && b < c2) {
        console.log('PASS: 递增间隔 [' + a + ',' + b + ',' + c2 + '] in ' + f);
        process.exit(0);
      }
    }
    if (/delay\s*\*=?\s*\d/.test(code) && /retry|REPORT_FAILED/i.test(code)) {
      console.log('PASS: 找到递增间隔乘法模式 in ' + f);
      process.exit(0);
    }
  }
  console.log('FAIL: 未找到严格递增间隔模式');
  process.exit(1);
"
```

**修复要点**: 解析数组三个数值后验证 `a < b && b < c`，确保实际递增。WS3 DoD 的对应 Test 字段也需同步更新。

## 可选改进（不阻塞合同通过）

### A. F1-C1 路由检查未剥离注释
注释中的 `'/harness'` 字符串会产生假阳性。建议追加注释剥离（与 F1-C3 一致的 `.replace(/\/\*[\s\S]*?\*\//g,'')` + 行注释过滤）。已被 F1-C3 串联覆盖，优先级低。

### B. F1-C3 API URL 未验证 brain/harness
命令验证了 `fetch|useSWR` 存在，但不验证 URL 包含 `brain` 或 `harness`。假实现可以 `useSWR('/unrelated')` 通过。建议追加 `/fetch.*(?:brain|harness|sprint)|useSWR.*(?:brain|harness|sprint)/` 正则。

### C. F3-C1 死代码可过关
常量 `MAX_RETRIES` + `REPORT_FAILED` 存在但从未被调用的情况下命令仍通过。建议追加检查 try/catch 或 error handler 中引用了 retry 逻辑。

## 整体评价

R4 合同质量显著提升——F1 路径架构修正正确、注释剥离到位、Workstream 边界清晰。仅 F3-C3 递增间隔验证存在实质性漏洞需修复。预计 R5 可 APPROVED。
