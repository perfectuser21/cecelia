# PRD: R2 — 直接 copy Superpowers 原生工件

## 背景
F3 (PR #2382) 和 F4 (PR #2386) 对齐 Superpowers 时只补了"概念"没补"工件"。Explore agent 二方验证戳穿了 5 个具体 gap：
1. Stack Trace 插桩法缺失（官方 systematic-debugging/root-cause-tracing.md L66-106 完整示例）
2. find-polluter.sh bisection 脚本缺失（官方 systematic-debugging/find-polluter.sh 63 行）
3. waitFor<T>() 实现代码缺失（官方 systematic-debugging/condition-based-waiting-example.ts 158 行）
4. Common Failures 教学表缺失（官方 verification-before-completion/SKILL.md L40-50）
5. Rationalization Prevention 教学表缺失（官方 verification-before-completion/SKILL.md L63-74）

用户原话：**"官方是开源的，所有细节都能看得到，为什么不直接 copy 过来？"**

根因：F3/F4 agent prompt 写的是"补缺口"，agent 理解成"写等价概念"而非"原样搬运"。这次明确约束：**能 copy 的原文必须 copy，不允许 paraphrase**。

## 目标
一次 PR 把 5 件官方工件 copy 到我们仓库，并在 02-code.md 里引用。

## 范围

### 1. 复制工具脚本

**src**: `~/.claude-account3/plugins/cache/superpowers-marketplace/superpowers/5.0.7/skills/systematic-debugging/find-polluter.sh`
**dst**: `packages/engine/scripts/find-polluter.sh`
**改动**: 保留官方 63 行 bash 的逻辑，顶部加 4 行注释说明来源 + 本地适配（vitest 命令替换 npm test，如果有差异），chmod +x

### 2. 复制 waitFor 实现

**src**: `~/.claude-account3/plugins/cache/superpowers-marketplace/superpowers/5.0.7/skills/systematic-debugging/condition-based-waiting-example.ts`
**dst**: `packages/brain/src/utils/condition-based-waiting.ts`
**改动**: 保留官方 158 行 TypeScript 原样，顶部加注释标明来源，封装为可 import 的 module（export waitFor + 辅助函数），加对应 .test.ts 单测

### 3. 02-code.md 补三块教学材料

**3.1 Common Failures 表**（在 '## Pre-Completion Verification' section 内）
从官方 verification-before-completion/SKILL.md L40-50 **逐字 copy**：
```
| 你想说 | 这要求什么 | 不够格的是 |
|---|---|---|
| Tests pass | Test 命令输出: 0 failures | 之前跑过, "应该会过" |
| Linter clean | Linter 输出: 0 errors | 部分检查, 外推 |
| Build succeeds | Build 命令: exit 0 | Linter 过, 日志看起来 OK |
... (7 行全部)
```

**3.2 Rationalization Prevention 表**（在同一 section）
从官方 verification-before-completion/SKILL.md L63-74 **逐字 copy**：
```
| 借口 | 现实 |
|---|---|
| 'Should work now' | RUN the verification |
| 'I'm confident' | Confidence ≠ evidence |
| 'Just this once' | No exceptions |
... (8 行全部)
```

**3.3 Stack Trace 插桩示例**（在 '## Root-Cause Tracing' section 内）
从官方 systematic-debugging/root-cause-tracing.md L66-106 **逐字 copy** + 本地化注释：
```typescript
async function execFileAsync(file, args, options) {
  const stack = new Error().stack;
  console.error('DEBUG git init:', {
    directory: options.cwd,
    cwd: process.cwd(),
    stack: stack?.split('\n').slice(0, 10).join('\n')
  });
  // ...
}

// 然后运行:
// npm test 2>&1 | grep 'DEBUG git init' > /tmp/polluter.log
// 分析 stack 输出找污染源
```

### 4. Engine 版本 bump 14.17.0 → 14.17.2（patch，只补工件无新逻辑）

### 5. feature-registry.yml 加 14.17.2 changelog 条目

## 不做
- 不改 waitFor 源码逻辑（保留官方 158 行原样，防偏差）
- 不改 find-polluter.sh 的 bisection 算法（只改 test runner 命令）
- 不写新测试覆盖 02-code.md 的教学表（它们是 docs）
- 不引入新 npm 依赖

## 验收条件 DoD（必须全部 [x] 且每条可机器验证）

- [x] [ARTIFACT] packages/engine/scripts/find-polluter.sh 存在且 executable
  Test: manual:bash -c "[[ -x packages/engine/scripts/find-polluter.sh ]]"

- [x] [ARTIFACT] find-polluter.sh 包含官方脚本核心逻辑（bisection 搜索函数名）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/scripts/find-polluter.sh','utf8');if(!c.includes('bisect')&&!c.includes('find-polluter'))process.exit(1)"

- [x] [ARTIFACT] packages/brain/src/utils/condition-based-waiting.ts 存在，export waitFor
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/utils/condition-based-waiting.ts','utf8');if(!c.includes('export')||!c.includes('waitFor'))process.exit(1)"

- [x] [BEHAVIOR] waitFor 单元测试通过（mock 时间/条件）
  Test: tests/condition-based-waiting.test.ts（agent 必须写）

- [x] [ARTIFACT] 02-code.md 含 Common Failures 表（关键词 '不够格的是' 或 'Not Sufficient'）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/02-code.md','utf8');if(!c.includes('Common Failures')&&!c.includes('不够格的是'))process.exit(1)"

- [x] [ARTIFACT] 02-code.md 含 Rationalization Prevention 表（关键词 '借口' 或 'Rationalization'）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/02-code.md','utf8');if(!c.includes('Rationalization')&&!c.includes('借口'))process.exit(1)"

- [x] [ARTIFACT] 02-code.md Root-Cause section 含 Stack Trace 插桩示例（关键词 'new Error().stack' 或 'DEBUG.*stack'）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/02-code.md','utf8');if(!c.includes('new Error().stack')&&!c.includes('Error().stack'))process.exit(1)"

- [x] [ARTIFACT] 来源标注：find-polluter.sh 和 condition-based-waiting.ts 顶部注释注明官方 url / path
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/scripts/find-polluter.sh','utf8');if(!c.includes('superpowers'))process.exit(1)"

- [x] [ARTIFACT] Engine 14.17.2 六文件同步
  Test: manual:bash -c "v=\$(cat packages/engine/VERSION);[[ \$v == 14.17.2 ]] && grep -q \"\\\"\$v\\\"\" packages/engine/package.json && grep -q \"^\$v\" packages/engine/.hook-core-version && grep -q \"^\$v\" packages/engine/hooks/VERSION"

- [x] [ARTIFACT] feature-registry.yml 14.17.2 changelog 引用 4 个 copy 来源
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');['14.17.2','find-polluter','condition-based-waiting','Common Failures'].forEach(t=>{if(!c.includes(t))process.exit(1)})"

## 核心约束（agent 必须严格遵守）

**COPY 原则**：
- 官方有的原文、表格、代码 → **逐字搬**（不允许 paraphrase）
- 本地化只限：中文标题翻译 + 改 npm test → npx vitest run（如果需要）
- 顶部必须注明 source URL / path
- 如果对齐困难（比如官方有 jest 调用但我们是 vitest）：本地化但必须在注释写明"本地化原因"

**禁止**：
- 重写 waitFor 的核心算法（会偏差）
- 把官方表格改成"更适合 autonomous 的版本"（F3 就犯过这个错）
- 跳过 source 注释

## 参考
- F4 独立验证报告（identified 这 5 个 gap）
- 官方文件路径：~/.claude-account3/plugins/cache/superpowers-marketplace/superpowers/5.0.7/skills/
- 教训：F3 agent prompt 说"补缺口"被理解成"写等价"，这次严格要求"原样 copy"
