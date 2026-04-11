---
id: cp-04110947-unify-publisher-scripts
date: 2026-04-11
branch: cp-04110952-cp-04110947-unify-publisher-scripts
pr: cecelia#2194
---

# Learning: 统一 publisher 脚本到 zenithjoy

## 背景

两套独立的 publisher 实现并行存在：
- `cecelia/packages/workflows/skills/*/scripts/` — 旧版，2026-03 建立
- `zenithjoy/services/creator/scripts/publishers/` — 新版，含统一入口 + registry.json + keepalive + Chrome 146 SSH 隧道修复

两套互不调用，导致修复只同步一边，用户明显感知到"修好了又坏了"。

## 决策

zenithjoy 作为唯一 source of truth。cecelia skills 只保留文档层（SKILL.md + REQUIREMENTS.md），路径指向 zenithjoy。

## 关键发现

- `REQUIREMENTS.md` 里也有 NODE_PATH 和脚本路径引用，只改 SKILL.md 不够
- cecelia batch scripts 写死了 `cecelia/node_modules` 为 NODE_PATH，迁移时需同步修改
- shipinhao-publisher 在 cecelia 里没有 SKILL.md，只有 scripts/，直接整目录删除

## 迁移后结构

```
zenithjoy/services/creator/scripts/publishers/   ← 唯一实现
cecelia/packages/workflows/skills/*/SKILL.md      ← 只做文档定义，路径指向 zenithjoy
```

## 以后维护规则

- 改 publisher 脚本 → 只改 zenithjoy
- cecelia SKILL.md 只改文档说明，不放脚本
- 新平台 → 先在 zenithjoy 实现，再在 cecelia 写 SKILL.md 文档
