# 小改动 PrepPRD：Brain 代码 + CI 快照同步 golden-path→capability skill 改名

## 改什么
1. `packages/brain/src/task-router.js:155` — `SKILL_WHITELIST['golden_path_proposal']`
   `'/golden-path-controller'` → `'/capability-controller'`
2. `packages/brain/src/harness-skill-relay.js:101` — `controllerSkillFor()`
   `taskType === 'golden_path_proposal' ? 'golden-path-controller' : 'harness-controller'`
   → `... ? 'capability-controller' : ...`
3. `scripts/sync-skills-snapshot.sh` — SKILLS 数组 4 个条目改名：
   `golden-path-controller/proposer/reviewer/mapper` → `capability-controller/proposer/reviewer/mapper`
4. 运行该脚本，把 `packages/workflows/skills/capability-*/SKILL.md` 从新 SSOT（zenithjoy-skills PR #184
   已合并到 main）同步进来，删除 `packages/workflows/skills/golden-path-*` 旧快照目录
5. 更新受影响测试的断言（TDD：先改测试期望值到新名字→跑红→改代码/脚本→跑绿）：
   - `packages/brain/src/__tests__/task-router-golden-path-proposal.test.js`
   - `packages/brain/src/__tests__/harness-skill-relay.test.js`（`controllerSkillFor`/`spawnSkillRelaySession` 两个 describe 块）
   - `packages/brain/src/__tests__/golden-path-proposal-wiring.test.js`
   - `packages/brain/src/__tests__/golden-path-skill-snapshot.test.js`（EXPECTED 字典 key 改名 +
     version/sha256 重新按新快照内容计算）

## 为什么改
决策 a340f100 追加口径（08-06，Alex 拍板）：golden-path 系 skill 全面改名为 capability 系（skill 层已在
zenithjoy-skills PR #184 落地）。Brain 代码里这两处硬编码字符串是 headless 派发 `golden_path_proposal`
任务时用来选 relay controller skill 的路由表——不同步会导致 Brain 去加载一个已经不存在的
`golden-path-controller` skill，`loadSkillContent` 硬 throw，headless GP 提案链路直接断（见
harness-skill-relay.js 注释里自己写的"未部署时 loadSkillContent 会带 skill 名 throw"）。
`packages/workflows/skills/` 是 CI/headless 读的快照拷贝（非 SSOT），SSOT 已改名，快照不刷新会漂移。

## 关联上下文
- 决策 a340f100：词汇终局，skill 层全面退役 golden-path
- zenithjoy-skills PR #184（已合并）：5 个 skill git mv 改名的 SSOT 侧改动
- 前序 handoff：`docs/handoffs/202608062247-capability-rename.md`（zenithjoy-skills repo），已标注这两处
  待办
- `skills-dist-distribution-chain` 三层分发链：SSOT → dist（手动 archive 刷）→
  `packages/workflows/skills/` CI 快照（本次改的是第三层 + 消费方代码）

## 影响范围
- 仅影响 Brain headless 派发 `task_type=golden_path_proposal` 时选中的 controller skill 名；有头交互
  `/capability` 门面已在用新名，不受影响
- `~/perfect21/zenithjoy-skills-dist` 手动 dist 快照本次不刷（不在 packages/brain 改动范围内，且
  interactive 三账号 symlink 已经指向刚合并的新 SSOT 内容，dist 落后只影响 dist 快照本身过期，
  不阻断本次改动；留作已知遗留，非本次 DoD）

## 验收标准
- [ ] `node scripts/facts-check.mjs` 通过
- [ ] `bash scripts/check-version-sync.sh` 通过
- [ ] `node packages/quality/scripts/devgate/check-dod-mapping.cjs` 通过
- [ ] 5 个受影响测试文件全绿（含新断言）
- [ ] CI 全绿
