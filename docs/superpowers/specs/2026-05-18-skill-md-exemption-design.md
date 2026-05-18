# Spec: SKILL.md 豁免分支保护 + harness pipeline 假阳性修复

**日期**: 2026-05-18  
**分支**: cp-0518223626-fix-branch-protect-skill-md-exemption

## 问题

1. `branch-protect.sh` 把所有 `/skills/` 路径标为 NEEDS_PROTECTION，导致 SKILL.md 文件也被分支保护拦截，无法在非 cp-* 分支直接编辑
2. `harness-evaluator/SKILL.md` rule 4 允许无 `jq -e` 的弱 oracle 命令仍然 PASS，导致 evaluator 假阳性
3. `harness-contract-proposer/SKILL.md` 禁止事项 #3 是 v5.0 遗留规则，直接与 v7.4+ 要求矛盾
4. `check-dod-purity.cjs` Rule 1 仍禁止 `[BEHAVIOR]` 出现在 DoD 文件，与 v7.4+ 协议矛盾

## 改动

### 1. hooks/branch-protect.sh
`/skills/` 路径下 `.md` 文件豁免保护，`.js/.ts/.sh` 等代码文件仍保护。

### 2. harness-evaluator/SKILL.md
rule 4：缺 `jq -e` → FAIL（不再容忍）

### 3. harness-contract-proposer/SKILL.md
删除禁止事项 #3（v5.0 遗留，与 v7.4+ 矛盾）

### 4. check-dod-purity.cjs
删除或反转 Rule 1，允许 `[BEHAVIOR]` 出现在 contract-dod-ws*.md 文件

## 测试策略

- `branch-protect.sh`：bash 单测，`.md` 在 `/skills/` → exit 0；`.js` → exit 2
- `check-dod-purity.cjs`：node 直跑，含 `[BEHAVIOR]` 的 DoD 文件不报错
- SKILL.md 改动：无需测试（文档）
