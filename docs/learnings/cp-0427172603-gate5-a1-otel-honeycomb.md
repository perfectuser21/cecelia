## Gate 5 A1 Honeycomb + Brain OTel SDK（2026-04-27）

### 根本原因

1. **lint-no-fake-test 拦截弱断言**：初始测试使用 `.toBeNull()`、`.not.toThrow()`、`.not.toBeNull()` 等弱断言，被 lint-no-fake-test Rule 1（所有 expect 均为弱断言）拦截。根本原因是验证"是否存在/是否为空"比验证"真实行为"更容易写，但不能验证 prod 改坏的场景。

2. **eslint `no-unused-vars` catch 绑定**：`catch (_) {}` 中的 `_` 变量被 `no-unused-vars` 规则报告 warning，配合 `--max-warnings 0` 导致 CI 失败。虽然规则配置了 `varsIgnorePattern: '^_'`，但该模式仅适用于变量声明，不适用于 catch 绑定参数。

3. **brainstorm 流程优化**：任务描述已经足够完整（指定了文件路径、依赖、测试策略），无需进入完整 brainstorm 对话，可以直接推进到 writing-plans + executing-plans。

### 下次预防

- [ ] OTel/SDK 类初始化模块的测试断言必须验证真行为（如 `sdk.start()` 被调用次数、返回对象的方法类型），不能用 `.toBeNull()` / `.not.toBeNull()` 等存在性断言
- [ ] catch 语句优先使用 ES2019+ optional catch binding（`catch { }` 不绑定变量），避免 `_` 变量 lint warning
- [ ] 任何新测试文件推送前本地先跑：`bash .github/workflows/scripts/lint-no-fake-test.sh origin/main`
- [ ] 新 brain src 文件本地先跑：`npx eslint src/<file>.js --max-warnings 0`
- [ ] PRD 描述完整时（指定了文件/依赖/测试策略）可跳过 brainstorm 对话，直接 writing-plans
