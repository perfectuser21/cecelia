# Learning: harness_contract_propose verdict=null 导致 GAN 链路中断

**日期**: 2026-04-09
**PR**: cp-04091027-harness-verdict-fallback

### 根本原因

`harness_contract_propose` agent 完成时（AI Done）未在输出中包含 `{"verdict": "PROPOSED"}` 关键字，导致 `extractVerdictFromResult()` 返回 null。execution.js 的 GAN 守卫判断 `verdict !== 'PROPOSED'` → 不创建 Reviewer → pipeline 在此处沉默中断，无任何错误信号。

### 修复方案

在结构化提取 + 正则 fallback 之后，增加第三层 fallback：
```
if (!proposeVerdict) → assume PROPOSED + console.warn
```

理由：AI Done 表示 agent 正常完成，contract_review 本身会校验合同质量（GAN 的 Reviewer 角色），不需要在 propose 环节用 verdict 作为守门条件。

### 下次预防

- [ ] harness_contract_propose skill 应在最后一条消息输出 `{"verdict": "PROPOSED"}`
- [ ] 对所有 GAN 步骤：当 verdict 提取失败时，优先创建下一步任务（而非沉默）
- [ ] Brain 应有"pipeline stall detector"：某类型任务 completed 但无下游任务 > 5min → alert
