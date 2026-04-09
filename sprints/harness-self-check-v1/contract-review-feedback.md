# Contract Review Feedback (Round 1)

## 必须修改项

### 1. [命令太弱 — 假阳性] Feature 1 验证命令 #2 — 空实现可通过

**问题**: Happy path 验证命令的第二条检查：
```
if (!c.includes('node') && !c.includes('npm') && !c.includes('psql'))
  throw new Error('FAIL: 未找到 CI 白名单允许工具');
```
当前 `harness-contract-reviewer/SKILL.md` 已包含 `npm`（第 68 行："业务逻辑没用 npm test 验证单元行为吗？"），
所以这个条件在**不做任何修改**的情况下就返回 PASS。

**影响**: Generator 可以只把 `grep` 加到文档任意位置（甚至注释里），
不写真正的白名单规则，依然通过所有测试。

**建议**: 改为检查白名单工具出现在 APPROVED 条件区块内，而非全文搜索：
```js
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/harness-contract-reviewer/SKILL.md', 'utf8'
  );
  const approvedBlock = c.split('**APPROVED 条件**')[1]?.split('**REVISION 条件**')[0] || '';
  if (!approvedBlock.includes('node') || !approvedBlock.includes('psql')) {
    throw new Error('FAIL: APPROVED 条件区块未明确列出 node/psql 白名单');
  }
  console.log('PASS');
"
```

### 2. [命令太弱] WS1 DoD item 1 — grep 可在任意位置触发 PASS

**问题**: Test: `if(!c.includes('grep'))throw new Error('FAIL')`
只检查 'grep' 是否出现在文件任意位置。Generator 可以把 "# 禁止 grep" 加在文件顶部，
不把它放入 REVISION 条件列表，测试依然 PASS。

**影响**: 核心修复（REVISION 条件新增白名单规则）可被绕过。

**建议**: 改为检查 REVISION 条件区块内包含 grep：
```js
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/harness-contract-reviewer/SKILL.md', 'utf8'
  );
  const revBlock = c.split('**REVISION 条件**')[1]?.split('###')[0] || '';
  if (!revBlock.includes('grep')) {
    throw new Error('FAIL: REVISION 条件区块未列出 grep 白名单规则');
  }
  console.log('PASS');
"
```

## 可选改进

- WS2 命令质量良好，path 校验逻辑严格，无需修改
- Feature 3 命令验证 `ls` 和 `cat` 出现在 SKILL.md 属于可接受弱测试（SKILL.md 是人类可读指令，不走 CI 白名单）

## 总结

2 个命令存在假阳性/可绕过问题，需修订后重新提交。
