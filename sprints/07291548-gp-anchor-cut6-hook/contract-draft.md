# Sprint Contract — GP锚定闭环 刀6（headed 咽喉机械化）

> 本合同为交互式 headed-session 事后补录（非标准 GAN 流程产出），如实反映已完成并测试通过的实现。

## Golden Path

[开发者在任意仓库 cp-* 分支首次 Write/Edit 代码文件] → [branch-protect hook 检查 .dev-mode.<branch> 的 gp_anchor 行] → [出口：无锚/格式非法/id 查无 → exit 2 拒绝写入（带自修复指引）；合法/none 豁免/fail-open → 放行]

### Step 1: 无锚拦截
**来源**: `[FROM_PRD]` — sprints/07291548-gp-anchor-cut6-hook（PrepPRD 已在会话中拍板）

**可观测行为**: `.dev-mode.<branch>` 缺 `gp_anchor:` 行 → hook exit 2，stderr 含 `GP-ANCHOR-MISSING` + 一行式补锚指引

**验证命令**:
```bash
bash hooks/tests/branch-protect-gp-anchor.test.sh
```

**硬阈值**: exit 0（S1~S5 全 PASS，其中 S1 断言无锚场景 exit 2）

---

### Step 2: 格式/id 校验与豁免
**来源**: `[FROM_PRD]`

**可观测行为**: 三形态格式正则校验；`none(infra|docs|config|backlog)` 直接放行；推进/keep-green 类 id 在 product-map（本仓库优先，中央 fallback）查无 → exit 2 并列出现有合法 id 清单

**验证命令**: 同 Step 1（S2 豁免放行 / S3 id 存在放行 / S4 id 查无拦截）

**硬阈值**: 同上

---

### Step 3: fail-open 保险（防锁死）
**来源**: `[FROM_PRD]` — 保险条款（宁漏勿锁死，CI lint-gp-anchor 兜底）

**可观测行为**: 两处 product-map.json 均不可得 / jq 缺失 / JSON 解析失败 → `[WARN]` 放行不拒绝

**验证命令**: 同 Step 1（S5 map 全缺 fail-open 放行）

**硬阈值**: 同上

---

## Risks

| 风险 | 说明 | Mitigation |
|---|---|---|
| 存量在途分支 .dev-mode 无锚被突然拦截 | 刀6上线即对所有 cp-* 分支生效 | 报错含 `echo 'gp_anchor: ...' >> .dev-mode.<branch>` 一行式自修复指引，10秒自助解决（一律硬闸拍板，无旁路） |
| hook 改坏锁死全部交互式开发 | branch-protect 是全局 PreToolUse | 三重 fail-open（map缺失/jq缺失/解析失败均放行）+ 回滚=revert 单 commit；id 校验只在"明确查无"时硬拒 |
| 全角标点紧贴 $VAR bash 解析崩溃 | EVA v2 已知模式，本刀实现中真实踩中一次（S4 曾 exit 1 unbound variable） | 已修（改花括号+半角括号），测试 S4 覆盖该路径 |

## 未覆盖真实链路清单
（本合同无 mock 豁免——测试直接调用真实 branch-protect.sh + 真实临时 git worktree + 真实 JSON stdin，N/A）

## 禁 mock 边清单
- 测试 ↔ branch-protect.sh（本单改 hook 本体，测试必须真调 hook 脚本，不 mock）——已满足：`bash "$HOOK"` 真实执行

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| ws1-hook | `packages/engine/hooks/tests/branch-protect-gp-anchor.test.sh` | S1 无锚拦、S2 none 豁免放行、S3 合法锚放行、S4 假 id 拦、S5 fail-open 放行 | → 实现前 S1/S4 判 FAIL（hook 无拦截逻辑，exit 0 与期望 exit 2 相反），见 red-evidence.md |
| ws1-hook-wrapper | `sprints/07291548-gp-anchor-cut6-hook/tests/gp-anchor-hook.test.js` | S1~S5 全过 | → 实现前 bash 测试 3 pass/2 fail → 包装器 expect(status).toBe(0) 红 |

## E2E 验收
```bash
bash hooks/tests/branch-protect-gp-anchor.test.sh
```
已在本地真实环境执行通过（5 pass / 0 fail），证据见 PR 描述。
