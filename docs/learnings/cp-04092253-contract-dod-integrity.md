# Learning: Contract DoD 完整性约束

**Branch**: cp-04092253-contract-dod-integrity  
**Date**: 2026-04-09

### 根本原因

GAN 对抗产出合同，但 Generator 的 DoD.md 是自行起草的，与合同是"两张皮"。
Generator 可能（无意或有意）写出比合同更宽松或不同的 DoD 条目，CI 无从知晓，
Evaluator 看到的 DoD 与合同约定的期望不一致，导致评估结果失真。

### 修复方案

三层闭环：
1. Proposer 输出 `contract-dod-ws{N}.md` 独立文件，作为 DoD 的唯一来源（SSOT）
2. Generator 从该文件原样复制，DoD.md 头部加 `contract_branch:` + `workstream_index:` 记录出处
3. CI `harness-dod-integrity` job：读取 contract_branch，fetch 对应文件，node 脚本比对条目文本，不一致则失败

### 下次预防

- [ ] 凡 DoD.md 含 `contract_branch:` header 的 PR，CI 自动校验 — 无需人工审查
- [ ] Proposer 必须为每个 workstream 单独生成 contract-dod-ws{N}.md，否则 Generator 无文件可读，降级到 fallback（警告但不 block）
- [ ] Generator 修改 DoD 条目文字（不只是 [ ] → [x]）会被 CI 拦截
