# Contract Review Feedback (Round 2)

## Triple 分析摘要

| 命令 | can_bypass | 原因 |
|------|-----------|------|
| F1 Happy Path 主验证 | N | 严格检查 3 字段 + 值 + 格式 |
| F1 Content-Type 验证 | Y | grep 违反 CI 白名单 + subshell exit 不传播 |
| F2 POST 拒绝 | Y | subshell exit 不传播 |
| F2 timestamp 递增 | N | node Date 比较逻辑严谨 |
| F3 version 一致性 | Y | subshell exit 不传播 |
| DoD ARTIFACT 文件存在 | Y | grep 字符串可在注释中（BEHAVIOR 覆盖，不严重） |
| DoD BEHAVIOR 3 字段 | N | 严格 |

覆盖率: 7/7 = 100% (≥ 80% ✅)
can_bypass 严重问题: 3 条

---

## 必须修改项

### 1. [CI 白名单违规] Feature 1 Content-Type 验证使用 grep

**原始命令**:
```bash
CTYPE=$(curl -sf -D - -o /dev/null "localhost:5221/api/brain/ping-extended" | grep -i content-type)
echo "$CTYPE" | grep -qi "application/json" && echo "PASS: Content-Type 正确" || (echo "FAIL: Content-Type 不含 application/json: $CTYPE"; exit 1)
```

**假实现片段**（proof-of-falsification）:
```bash
# 1. grep 不在 CI 白名单，命令根本无法执行
# 2. 即使能执行，(exit 1) 在子 shell 中不影响父进程退出码
echo "text/plain" | grep -qi "application/json" || (echo "FAIL"; exit 1)
echo "父进程退出码: $?"  # 输出 0
```

**建议修复命令**:
```bash
node -e "
  const { execSync } = require('child_process');
  const headers = execSync('curl -sf -D - -o /dev/null localhost:5221/api/brain/ping-extended').toString();
  if (!/content-type:.*application\/json/i.test(headers)) {
    console.log('FAIL: Content-Type 不含 application/json');
    process.exit(1);
  }
  console.log('PASS: Content-Type 正确');
"
```

### 2. [exit code 泄漏] Feature 2 POST 拒绝 — subshell exit 不传播

**原始命令**:
```bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:5221/api/brain/ping-extended")
[ "$STATUS" -ge 400 ] && [ "$STATUS" -lt 500 ] && echo "PASS: POST 返回 $STATUS (4xx)" || (echo "FAIL: POST 期望 4xx，实际 $STATUS"; exit 1)
```

**假实现片段**（proof-of-falsification）:
```bash
# 假设端点接受 POST 并返回 200
STATUS=200
[ "$STATUS" -ge 400 ] && [ "$STATUS" -lt 500 ] && echo "PASS" || (echo "FAIL: $STATUS"; exit 1)
echo "之后还会执行，exit code=$?"  # 0，子shell 的 exit 1 不传播
```

**建议修复命令**:
```bash
node -e "
  const { execSync } = require('child_process');
  const status = execSync('curl -s -o /dev/null -w \"%{http_code}\" -X POST localhost:5221/api/brain/ping-extended').toString().trim();
  const code = parseInt(status);
  if (code < 400 || code >= 500) { console.log('FAIL: POST 期望 4xx，实际 ' + code); process.exit(1); }
  console.log('PASS: POST 返回 ' + code + ' (4xx)');
"
```

### 3. [exit code 泄漏] Feature 3 version 一致性 — subshell exit 不传播

**原始命令**:
```bash
API_VER=$(curl -sf "localhost:5221/api/brain/ping-extended" | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version)")
PKG_VER=$(node -e "console.log(require('./packages/brain/package.json').version)")
[ "$API_VER" = "$PKG_VER" ] && echo "PASS: version 一致 ($API_VER)" || (echo "FAIL: API=$API_VER, package.json=$PKG_VER"; exit 1)
```

**假实现片段**（proof-of-falsification）:
```bash
# 假设 version 硬编码为 "0.0.1" 而非读取 package.json
API_VER="0.0.1"
PKG_VER="4.19.0"
[ "$API_VER" = "$PKG_VER" ] && echo "PASS" || (echo "FAIL: API=$API_VER, pkg=$PKG_VER"; exit 1)
echo "继续执行，exit code=$?"  # 0
```

**建议修复命令**:
```bash
node -e "
  const { execSync } = require('child_process');
  const apiOut = execSync('curl -sf localhost:5221/api/brain/ping-extended').toString();
  const apiVer = JSON.parse(apiOut).version;
  const pkgVer = require('./packages/brain/package.json').version;
  if (apiVer !== pkgVer) { console.log('FAIL: API=' + apiVer + ' pkg=' + pkgVer); process.exit(1); }
  console.log('PASS: version 一致 (' + apiVer + ')');
"
```

### 4. [硬阈值遗漏] Feature 2 声明 "响应时间 < 500ms" 但无验证命令

**原始命令**: （缺失）

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：端点内做 2 秒 sleep，合同无法检测
app.get('/api/brain/ping-extended', async (req, res) => {
  await new Promise(r => setTimeout(r, 2000));
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});
```

**建议修复命令**:
```bash
node -e "
  const { execSync } = require('child_process');
  const start = Date.now();
  execSync('curl -sf localhost:5221/api/brain/ping-extended');
  const elapsed = Date.now() - start;
  if (elapsed > 500) { console.log('FAIL: 响应时间 ' + elapsed + 'ms > 500ms'); process.exit(1); }
  console.log('PASS: 响应时间 ' + elapsed + 'ms < 500ms');
"
```

## 可选改进

- Feature 2 timestamp 递增验证中 `sleep 0.1` 在 CI 环境下可能不够稳定，建议改为 `sleep 1` 保证可观测差异
- DoD ARTIFACT 验证可增加 `app.get` 或 `router.get` 关键词检查，排除注释中的假匹配（但因有 BEHAVIOR 覆盖，优先级低）
