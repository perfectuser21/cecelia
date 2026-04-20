# Phase 7.5 设计：死 DoD sweep + CI 回归测试

**日期**：2026-04-20
**分支**：cp-0420161725-cp-04201617-phase75-dod-sweep
**Engine 版本**：v18.3.2 → v18.3.3（patch）

## 背景

Phase 8.3（PR #2463）实施时撞到死 DoD — DoD 文件里 `manual:node -e "...readFileSync('~/.claude/skills/harness-report/SKILL.md')..."` 引用了本地开发环境路径，CI runner 上不存在该文件，且 repo 里 `packages/workflows/skills/harness-report/SKILL.md` 也没有断言要找的 "Initiative 级 Report" 字符串。这条死命令导致无关 PR 的 CI 失败。

仓库里还有 152 个历史 per-PR DoD/PRD 残留，`.github/workflows/cleanup-merged-artifacts.yml` 本应自动清理但 regex 漏 `.dod-` 前缀。

## 范围

### 做

1. **扫描全仓**：Python 脚本遍历所有 `Test: manual:` 含 `node -e` 命令，执行并报告 dead。
2. **删除历史残留**：152 个 per-PR 副本（root + packages/brain + packages/quality + packages/workflows）。
3. **删除 stale 文件**：根目录 `.dod.md` / `.prd.md` / `.prd.md.old` / `TASK.md` + packages/ 内 5 个同类（.gitignore 已含但历史 commit 进去了）。
4. **修 cleanup-merged-artifacts.yml**：regex 加 `.dod-` 前缀。
5. **新增回归测试**：`packages/engine/tests/dod/dod-manual-commands.test.ts`，覆盖 `check-manual-cmd-whitelist.cjs` 白名单边界。
6. **版本 bump**：Engine 7 处同步 18.3.3 + feature-registry 条目。

### 不做

- **不执行所有 manual 命令的 CI 扫描**：成本过高（460 条命令，CI 要跑几分钟 + 很多是 skipped curl/psql 需要 Brain spin-up）。本 PR 只上白名单格式校验，future work 考虑 enforce manual exec。
- **不删除 `sprints/` 下早期迭代 task-card.md**：那是 harness 活跃输出区，owner 另行清理。
- **不改 `check-dod-mapping.cjs` 本身**：已有假测试检测，本 PR 只加单元测试覆盖。
- **不碰 `DEFINITION.md`** / hooks / proxy / integration-test（其他 agent 负责）。

## 架构

```
PR 触发 → CI L1 "DoD 格式检查"（grep BEHAVIOR / unchecked）
        ↓
     CI L1 "DoD BEHAVIOR 命令执行"（eval node 命令）
        ↓  ← 如果 DoD 里有死命令 → 失败
        
Phase 7.5 新增：
     CI L1 engine vitest
        ↓  含 tests/dod/dod-manual-commands.test.ts
        ↓  验证 check-manual-cmd-whitelist.cjs 白名单语义
        ↓  抓住：~/.claude/* 路径、grep/ls/cat 等非白名单 prefix
        
PR 合并到 main → cleanup-merged-artifacts.yml 扫 git ls-files
                 ↓  删除 .prd-/.task-/.dod-/DoD.cp-/PRD.cp-/TASK_CARD.cp- 前缀文件
                 ↓（Phase 7.5 修：加 .dod- 前缀）
                 ↓ commit + push
```

## DoD

- [x] [ARTIFACT] cleanup-merged-artifacts.yml regex 补齐 `.dod-` 前缀
  - Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/cleanup-merged-artifacts.yml','utf8');if(!c.includes('\\\\.dod-|'))process.exit(1);if(!c.includes('Phase 7.5'))process.exit(2)"`
- [x] [ARTIFACT] 历史 per-PR 残留清空
  - Test: `manual:node -e "const fs=require('fs');const bad=fs.readdirSync('.').filter(f=>/^(\\.task-cp-|\\.dod-cp-|\\.prd-cp-|DoD\\.cp-|PRD\\.cp-)/.test(f));if(bad.length>0)process.exit(1)"`
- [x] [ARTIFACT] 根 stale 文件清空
  - Test: `manual:node -e "['.dod.md','.prd.md','.prd.md.old','TASK.md'].forEach(f=>{if(require('fs').existsSync(f))process.exit(1)})"`
- [x] [BEHAVIOR] dod-manual-commands.test.ts 验证 check-manual-cmd-whitelist.cjs
  - Test: `tests/dod/dod-manual-commands.test.ts`（位于 packages/engine）
- [x] [ARTIFACT] Engine 7 处版本同步 18.3.3
  - Test: `manual:node -e "['packages/engine/VERSION','packages/engine/.hook-core-version','packages/engine/hooks/VERSION'].forEach(f=>{if(require('fs').readFileSync(f,'utf8').trim()!=='18.3.3')process.exit(1)})"`
- [x] [ARTIFACT] feature-registry.yml 含 18.3.3 条目 + dead-DoD-sweep 描述
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('18.3.3'))process.exit(1);if(!c.includes('死 DoD')&&!c.includes('dod-sweep'))process.exit(2)"`

## Review（autonomous，B-5 spec approval）

**依据**：
- 用户的话：Phase 7.5 任务 "扫描并清理仓库里所有死 DoD 测试命令和假测试命令，走完整 /dev 流程到 PR 合并"
- 代码：`.github/workflows/cleanup-merged-artifacts.yml`（regex 漏抓 `.dod-`）+ `scripts/devgate/check-manual-cmd-whitelist.cjs`（已有但无回归测试）
- OKR：Cecelia Engine KR — CI 质量门禁体系不出假阳性/假阴性

**判断**：APPROVE

**confidence**：HIGH

**质量分**：8/10

**风险**：
- R1：删除 152 文件可能影响 blame/history 查询，但这些文件已合并多时，实际业务价值为零
- R2：vitest 测试依赖 `require()` 动态加载 .cjs 脚本，如果脚本路径变化会 break — 已用 `process.cwd()` + 相对路径缓解

**下一步**：进入 writing-plans → inline 实施完成
