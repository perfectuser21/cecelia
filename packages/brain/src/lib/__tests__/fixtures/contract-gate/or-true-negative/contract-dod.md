# Or-True Negative Fixture — 负向测试（预期失败）惯用法不应被 cheat/or-true 误伤

> 永久回归样本：取自生产 run d8acba51（ci-defense 合同）。
> `cmd && { echo FAIL; exit N; } || true` 语义 = "cmd 应失败；若反而成功则主动 FAIL"。
> 这里的 `|| true` 是对【预期失败】的合法承接（set -e 下避免预期失败杀脚本），
> 不是吞掉真实断言失败码 → gate 不应判 cheat/or-true。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 改了测试但路由器漏判时应 fail-closed（exit 非 0），负向验证它确实失败
  Test: manual:bash -c 'node scripts/changed-test-router.mjs 2>/dev/null && { echo "FAIL: 应 fail-closed 但 exit 0"; exit 1; } || true'

- [ ] [BEHAVIOR] 缺合同时 gate 应 exit 1，负向验证它确实非零退出
  Test: manual:bash -c 'node scripts/contract-gate-check.mjs "$TMPDIR" 2>/dev/null && { echo "FAIL: 缺合同应 exit 1"; rm -rf "$TMPDIR"; exit 1; } || true'
