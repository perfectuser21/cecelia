# Capture-Negative-Assert Fixture — 捕获形态负向测试不应被 cheat/or-true 误伤（缺陷 B）

> 永久回归样本（生产 run da418741，ci-defense-r2 合同）：
> `VAR=$( <预期失败命令> 2>&1 || true)` 把【预期失败】命令的输出捕获进变量，
> 末尾 `|| true` 仅为让命令替换不因预期失败而中断（与 #3351 单语句负向断言同语义），
> 随后【K=5 条逻辑语句内】对同名 `$VAR` 施加值断言（grep -q / jq -e / [ 比较 / case）。
> gate 不应判 cheat/or-true，应全过（exit 0）。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 篡改测试后路由器应 fail-closed（捕获日志后断言其确实报 env_missing）
  Test: 见下方验收脚本

```bash
TAMPER_LOG=$(EVALUATOR_SKILL_FIXTURE="$FIXTURE" npx vitest run packages/brain/src/lib/__tests__/contract-gate.test.js 2>&1 || true)
echo "$TAMPER_LOG" | grep -q "FAIL.*env_missing" || { echo FAIL; exit 1; }
```
