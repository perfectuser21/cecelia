# Learning: Brain 侧强制 Harness worktree 使用 cp-* 分支

**Branch**: cp-04240814-brain-cp-branch-enforce
**Date**: 2026-04-24

### 根本原因

Harness v2 Generator 跑在 Docker 容器里，读 SKILL.md 后在 worktree 内提交代码。但 SKILL.md 对 LLM 只是"建议"——即便写了"禁止用 `harness-v2/task-<uuid>`"，Generator 仍有一定概率直接在 Brain 建 worktree 时的默认分支上 commit，导致 CI `branch-naming` check 挂掉，每次都要人工 rename。

错在规则放错了层：**Brain 才是唯一拥有分支命名权的地方**，LLM 不可靠。`packages/brain/src/harness-worktree.js` 一直硬编码 ``const branch = `harness-v2/task-${sid}``，clone 后直接 `checkout -b` 到这个不合规分支名，Generator 收到的就是一个 CI 注定要挂的 worktree。

### 下次预防

- [ ] Brain 侧任何产出分支名的路径都必须符合 `hooks/branch-protect.sh` 正则 `^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$` + CI `branch-naming` 的 `^(cp-|feature/|fix/|chore/|docs/)`
- [ ] 新增 `packages/brain/src/harness-utils.js#makeCpBranchName(taskId, { now })`，所有 Brain 产 cp-* 分支的地方都走这一个入口，不准就地拼字符串
- [ ] 同一时区规则：`MMDDHHMM` 8 位一律上海时区（UTC+8），避免 CI 在 UTC 跑时分支名错位
- [ ] SKILL.md 的"建议"保留作为文档参考，但**不作为系统正确性的依赖**

### 技术知识

**MMDDHHMM 生成（CI 在 UTC 跑，必须显式加 8h offset）**：
```js
const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
// ... 用 getUTCDate/getUTCHours/getUTCMinutes，不用 getHours（会被本机时区扰动）
```

**rebase origin/main 容错**：Initiative 并行派多个 ws 可能改同一文件，rebase 冲突不应该 block。对策：`try { fetch + rebase } catch { log warn; rebase --abort }`，让 Generator 进去后自行处理冲突。

**目录名保留 `harness-v2/task-<sid>`，只改分支名**：docker-executor 按目录挂载 worktree，目录名更改涉及面广。分支名和目录名解耦后向后兼容。

**迁移平滑**：已有 worktree 目录若处于旧 `harness-v2/task-*` 分支，复用时自动 `checkout -B` 到新的 cp-* 分支（`checkout -B` 不冲突就复用，冲突就重置）。
