# Controller 过滤后的合同修改请求（Round 2 → Round 3）

经 controller 核查，reviewer 5 条反馈中 F2/F3 是误判，只需处理 F1/F4/F5。

## 必须修改

### [F1] 修复 ASSERT-1 正则（高优先级）

文件：`packages/engine/tests/integrity/ci-blindspot-contract.test.sh` 第 36 行

**问题**：当前正则 `event_name.*(==|!=).*push` 不匹配 bash 单等号写法 `[ "${{ github.event_name }}" = "push" ]`，  
会导致正确修法产生误判（测试 FAIL 但修法是对的）。

**修改**：将正则改为接受 `=`、`==`、`!=` 三种写法：
```bash
# 改前
if echo "$CHANGES_BLOCK" | grep -qE 'event_name.*(==|!=).*push'; then

# 改后（[!=]*= 匹配 =、==、!=）
if echo "$CHANGES_BLOCK" | grep -qE 'event_name.*[!=]*=.*push'; then
```

同时更新注释说明：
```bash
# 提取 changes: job 到下一顶层 job 之间的内容，检测 event_name 比较逻辑（接受 = / == / !=）
```

### [F5] contract-dod.md 补 I7 测试不可改约束（低优先级）

在 contract-dod.md 的 Invariant 验收标准表中追加一行：

| I7 | 契约测试文件不可改 | 从 Commit-1 到 PR 合并，`packages/engine/tests/integrity/ci-blindspot-contract.test.sh` 不得被修改 | lint-tdd-commit-order 或 git diff 核查 |

## 记录即可（不需要修改代码）

### [F4] 文档注明 engine-tests-shell 条件门（中优先级）

在 contract-draft.md 的"四、不包含"或新增"五、风险与限制"段中补充说明：

> **R1 已知限制**：`ci-blindspot-contract.test.sh` 由 `engine-tests-shell` job 接线，
> 触发条件为 `engine == 'true' || refs/heads/main`。
> 对于仅改 brain 代码的 PR（engine=false），该契约测试不会在 PR CI 中运行，
> 但会在合入 main 后的下次 push CI 中运行（这是可接受的时差，main push 全量兜底是本次修复的核心）。

## 不需要修改（controller 驳回）

- **F2（check 函数 skipped 语义）**：通用 `check()` 对条件触发 job 正确，`brain-tests-shell` 有 `if:` 条件，  
  非 brain PR 合理 skip，使用严格 `!= success` 会破坏非 brain PR 的 CI 通过。无需修改。

- **F3（set -e 静默失败）**：测试文件使用 `if ... then ... else ... fi` 结构（非 `&& ||` 链），  
  `set -e` 不会在 if 语句条件失败时触发，无静默失败风险。无需修改。

## 操作说明
1. 只改上述三处（F1 测试正则、F5 DoD I7、F4 注释文档）
2. push 到 cp-07291011-ws-241578ce 覆盖现有文件
3. **不要改 TDD 红态的语义**——修改正则后，在未修复的 ci.yml 对照下 ASSERT-1 应仍然 FAIL
