# Handoff：Cecelia staging/dev 前端已重新拉起 + 撞名根因已修复合并

**Initiative**: `0935f962-f67e-456d-9c5b-997899a7ea95`（Cecelia KR1，接续上一份 handoff）
**task_id**: unknown（本次交互式 /dev，未预先注册 Brain task）
**Verdict**: PASS

---

## 完成的事

### 1. P0：Cecelia staging(5212)/dev(5213) 前端已重新拉起，六档全绿

从持久目录 `/Users/administrator/perfect21/cecelia-deploy-main`（main 分支、非临时 worktree）手动
`docker compose up -d` 重建。实测 curl 200：

| 档位 | 后端 | 前端 |
|---|---|---|
| prod | ✅ 5221 | ✅ 5211 |
| staging | ✅ 5222 | ✅ 5212 |
| dev | ✅ 5220 | ✅ 5213 |

### 2. 找到并修复了比"worktree 收割器"更实锤的根因，已 PR #3880 merged

**根因**（比上一份 handoff 猜测的"worktree 收割器"更确定）：`docker-compose.dev.yml` 之前缺
`name:` 字段，会继承根 `.env` 的 `COMPOSE_PROJECT_NAME=cecelia`——docker compose 项目名优先级
是 `-p flag > COMPOSE_PROJECT_NAME 环境变量 > 文件内 name: 字段`，所以哪怕 dev.yml 加了
`name:` 字段也会被本机 `.env` 覆盖成和 **生产 `docker-compose.yml`（`name: cecelia`）同一个
project**。dev.yml 里还残留重复定义的 `node-brain`/`frontend` 死代码块（`container_name`
直接等于生产容器名，挂载 Linux 专属路径 `/home/xx/...`，本机根本不存在，明显是遗留死代码）。

**后果**：任何 `docker compose -f docker-compose.dev.yml up -d --remove-orphans` 都会把生产的
`node-brain`/`frontend` 当作本项目"孤儿"，用 dev.yml 里过时的坏定义重建，直接打断生产。

**本session实测复现两次**（在手动重新拉起 staging/dev 前端过程中，操作不当触发）：
- 第一次：`up -d --remove-orphans` 直接把生产 node-brain/frontend 换成坏的 node:20-alpine 挂载配置，容器进入 crash loop（`ERR_MODULE_NOT_FOUND: dotenv` / `ENOENT package.json`）
- 第二次：修完 dev.yml 后测试同一命令，仍触发（因为 `.env` 的 `COMPOSE_PROJECT_NAME` 优先级更高，文件内 `name:` 字段没生效）

每次都在数十秒~90秒内手动恢复（用 `docker compose -f docker-compose.yml up -d node-brain frontend` 重建正确的生产容器），未造成数据丢失，恢复后立即 curl 验证 200。

**修法**（PR #3880，已 merged）：
1. `docker-compose.dev.yml` 加 `name: cecelia-dev`
2. 删除 dev.yml 里重复定义、撞生产容器名的 `node-brain`/`frontend` 死代码块
3. 本机根 `.env` 里未纳入版本控制的 `COMPOSE_PROJECT_NAME=cecelia` 已本地删除，让 prod(`cecelia`)/staging(`cecelia-staging`)/dev(`cecelia-dev`) 三档 `name:` 字段各自生效
4. 新增回归测试 `scripts/__tests__/compose-project-isolation.test.sh`（TDD 两段式：先红后绿，已验证对原 bug 状态会 FAIL）
5. 修复后重新用 `up -d --remove-orphans` 实测同一条命令，确认生产容器不再被误删

## 还没做 / 交给下一个 session

### P1（原 handoff 遗留，现已大部分被上面的根因取代，可能仍值得核实）

`worktree-reaper-active-issue.md`（Notion issue `2ea607ec`，仍 In progress）描述的是 worktree
**目录**清理误连带清 Docker 容器；本次找到的撞名根因是完全独立的另一条路径（不需要涉及任何
worktree 删除，只要跑一次带 `--remove-orphans` 的 dev/staging compose 命令就会触发）。两者可能
都在历史上贡献过"前端消失"的现象，不是互斥关系。如果以后再遇到 staging/dev 前端消失，先查是否
有人跑过 `docker compose -f docker-compose.{dev,staging}.yml up -d --remove-orphans`（本次修复后
理论上已安全，但其他机器如果也有类似未纳入版本控制的 `.env` 覆盖，仍可能触发）。

### P2：ZenithJoy staging(5201) 为什么连不上（独立旧问题，未处理）

上一份 handoff 已确认是既有问题（launchd LaunchAgent 找不到该 label），本次未涉及，另案处理。

### 不需要做的事

- ZenithJoy prod 数据库仍连 `cecelia` 库——双写验证期到 2026-07-16，到期后按
  `scripts/zenithjoy-db-compare.sh` 决定是否切，不要提前切
- Cecelia 各档后端/数据库层——这层依然稳，本次未改动

---

## 数据源

- `docs/handoffs/202607141530-0935f962-followup-frontend-drift.md`（上一份，本次接续起点）
- PR #3880（`perfectuser21/cecelia`，已 merged）— docker-compose.dev.yml 项目名隔离修复
- decision `ad6f0222-0131-44a2-b35e-e6e9251b84fe`（bug-fix 记录，含完整根因分析）
- `scripts/__tests__/compose-project-isolation.test.sh`（回归守卫，CI 每次 push 跑）
- Notion issue `2ea607ec`（worktree 收割器，仍 In progress，与本次根因是两条独立路径）
