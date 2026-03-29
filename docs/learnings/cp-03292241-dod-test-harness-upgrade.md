# Learning: DoD Test 字段断言强度检查

## 概要
升级 check-dod-mapping.cjs 新增 validateAssertionStrength 函数，拦截 manual: 中无断言逻辑的 node/bash 命令（如 `node -e "console.log('ok')"`）。

### 根本原因
旧版 check-dod-mapping.cjs 只检测明显的假测试（echo/grep|wc-l/test -f），但对"看似可执行但无断言"的命令（如 `node -e "console.log('ok')"`）不拦截。这类命令永远 exit 0，无法验证任何行为。

### 下次预防
- [ ] DoD 的 manual: node 命令必须包含 process.exit/throw/if 等退出码判定逻辑
- [ ] 修改 check-dod-mapping.cjs 时，同步检查 Quality System Meta Tests 的 fixture（tests/quality-system/test-check-dod-mapping.sh），因为 fixture 中的 DoD 示例也必须符合新规则
- [ ] DoD Test 中嵌套执行 check-dod-mapping.cjs 的场景（如 L31 强测试验证），需要考虑 CI 环境 GITHUB_ACTIONS 变量传递问题，内部测试命令也会被实际执行
- [ ] detectFakeTest 的正则匹配需用 top-level command 检查（`cmd.trim().split(/\s/)[0]`），避免 node -e 内部引用的字符串误触发

### 关键修复
1. **validateAssertionStrength**: 新增 node -e / bash -c 命令的断言逻辑检查
2. **detectFakeTest 正则修复**: 从全文匹配改为只检查顶层命令，避免 node 内嵌字符串误触发
3. **Quality Meta Test**: 更新 fixture 中的 BEHAVIOR 命令，添加断言逻辑
4. **DoD L31 CI 兼容**: 嵌套执行时清除 GITHUB_ACTIONS 环境变量，避免内部命令被实际执行
