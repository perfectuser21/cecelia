# Reviewer Feedback — Round 1 (REVISION_NEEDED)

## RUBRIC SCORES (7维, 阈值7/10)
- dod_machineability: 4
- scope_match_prd: 9
- test_is_red: 4
- internal_consistency: 5
- risk_registered: 8
- verification_oracle_completeness: 5
- ci_workflow_alignment: 10

## 唯一阻塞问题

`contract-dod.md` 中 `[BEHAVIOR] 当前 task 的 Brain API payload 关键字段齐全且不含敏感字段明文` 的
`manual:bash` Test 命令缺少 `export TASK_ID`：

```bash
TASK_ID="${TASK_ID:-7630f4fb-...}"; ...; RESP=$(curl -sf ...); echo "$RESP" | jq -e ".id == env.TASK_ID" >/dev/null; ...
```

jq 的 `env.TASK_ID` 只读真实环境变量，未 export 时恒为 null，导致 `.id == env.TASK_ID` 恒为 false，命令恒 exit 1。
已实测复现：exit=1。对照实测 BEHAVIOR-1（smoke+allowlist）与 BEHAVIOR-3（DB initiative_runs）均实测 PASS，只有这一条恒 FAIL。

同样缺陷也存在于 `contract-draft.md` Golden Path Step 2 的独立"验证命令"代码块。
`## E2E 验收` 完整脚本里已正确写了 `export TASK_ID`，三处出现分叉（internal_consistency 扣分点）。

## 修复要求
1. `contract-dod.md` 该 BEHAVIOR 的 `manual:bash` 命令字符串里，`TASK_ID="${TASK_ID:-...}"` 之后加一行 `export TASK_ID`
2. 同步修 `contract-draft.md` Step 2 的独立验证命令块，与 `## E2E 验收` 完整脚本写法保持一致，消除单源漂移
