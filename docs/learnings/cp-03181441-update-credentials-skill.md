# Learning: 更新 credentials SKILL.md — 1Password 优先流程

## 概要

将 credentials skill 的凭据管理流程从"直接写 ~/.credentials/"改为"1Password 优先，sync 到本地缓存"。

## 变更内容

- `packages/workflows/skills/credentials/SKILL.md`：重写凭据管理流程，以 1Password CS Vault 为 SSOT

### 根本原因

原 SKILL.md 指引是 `cat >> ~/.credentials/`，导致新凭据只在本地，1Password 里缺失。
正确流程：1Password 是唯一真实源 → sync-credentials.sh → ~/.credentials/（只是缓存）。

### 下次预防

- [ ] 新 SKILL.md 中涉及凭据存储，必须先写 1Password 步骤，再写本地缓存步骤
- [ ] SKILL.md 中不允许出现 `cat >> ~/.credentials/` 这种直接写法
- [ ] sync-credentials.sh 是标准同步工具，需在 SKILL.md 中明确引用

## 教训

credentials 流程文档与实际规范脱节时，AI 代理会按文档操作，导致凭据漂移（本地有、1P 没有）。
文档即规范，文档错了规范就错了。
