# GAN Round 1 Reviewer Feedback — VERDICT: REVISION

审查分支：cp-07231921-harness-propose-r1-137fea96

## Rubric（7维，REVISION 触发维度标粗）

- dod_machineability: 9
- scope_match_prd: 9
- test_is_red: 10
- internal_consistency: 7
- risk_registered: 8
- **verification_oracle_completeness: 5**（< 7，唯一阻塞维度）
- ci_workflow_alignment: 10

## 必须修（block 项）

### 问题 1（verification_oracle_completeness，5→目标≥7）
Response Schema 声明的 404 `id` 字段、409 `error`/`details` 字段，全程没有任何 jq -e / expect 断言校验。

修复：
- 404 BEHAVIOR 补 `jq -e '.id == "<TID>"'`
- 两条 409 BEHAVIOR（completed / cancelled）都改成落盘响应体后 `jq -e '.error|type=="string"'` + `jq -e '.details|type=="string"'`
- 可选补一条 200 响应 `jq -e 'has("id") and has("status")'` 完整性检查

### 问题 2（internal_consistency，7分，建议一并修）
BEHAVIOR4（cancelled 再次 DELETE→409）没有对应 Golden Path 步骤，也没有进最终 `## E2E 验收` 脚本；PRD 边界情况明确要求覆盖 completed **和** cancelled 两个终态，最终 gate 脚本目前只测了 completed。

修复：在最终 E2E 脚本里补一小段 cancelled 幂等断言，与 DoD/Test Contract 对齐。

## 未阻塞项（不需要修，仅供参考）
其余 6 维均 ≥7，DoD 机检性/scope 对齐/Red 证据/风险登记/CI 对齐均合格。
