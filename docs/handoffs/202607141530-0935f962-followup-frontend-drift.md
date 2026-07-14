# Handoff：Cecelia×ZenithJoy三档分离 — 收尾复核发现前端漂移，需要新session修

**Initiative**: `0935f962-f67e-456d-9c5b-997899a7ea95`（Cecelia KR1）
**Verdict**: PARTIAL —— 后端+数据库层基本真独立，但Cecelia staging/dev前端在我部署完之后又消失了，需要新session重新部署+根治部署方式本身的问题

---

## 先看这个：为什么之前说"完成"了，现在又不对

本session（2026-07-14）连续做了5个PR，每个PR合并后我都做了**实时curl验证**（部署完立刻curl，200/内容匹配才算过），验证结果当时都是真的——不是编造的。但**验证的时间点和用户看到汇报的时间点之间，隔了后续几个PR的自动重部署周期**，其中至少 Cecelia staging(5212)/dev(5213) 两个前端容器，在验证通过之后的某个时间点消失了。

**这是一个关于"部署方式本身不耐久"的问题，不是我撒谎或者没测**：我用的部署方式是——`git worktree add` 建一个临时worktree（从origin/main拉最新代码）→ 在里面跑 `docker compose up -d` → 验证 → **`git worktree remove` 把临时worktree删掉**。容器起来后确实在跑、确实验证通过，但容器的 compose 元数据（`com.docker.compose.project.config_files`）记录的是那个临时worktree里的 `docker-compose.staging.yml`/`docker-compose.dev.yml` 路径——这个路径后来被我自己删掉了。

**最大嫌疑（未100%实锤，需要新session确认）**：memory `worktree-reaper-active-issue.md` 记录这是一个**仍然活跃的已知问题**——有个"worktree收割器"机制会扫描并清理跟已删除worktree相关联的资源。我的部署方式（临时worktree起容器→删worktree）正好撞上这个收割器的判据。

## 现在的真实状态（2026-07-14 15:30 CST 实测，不要凭我之前的汇报）

### Cecelia

| 档位 | 后端 | 数据库 | 前端 |
|---|---|---|---|
| prod | ✅ 5221 | ✅ `cecelia` | ✅ 5211（`cecelia-frontend`容器，来自`/Users/administrator/perfect21/cecelia`的标准docker-compose.yml，project=cecelia） |
| staging | ✅ 5222 | ✅ `cecelia_staging` | ❌ **5212连不上，容器`cecelia-frontend-staging`已不存在**（`docker ps -a`查不到，不是stopped，是彻底没了） |
| dev | ✅ 5220 | ✅ `cecelia_dev` | ❌ **5213连不上，容器`cecelia-frontend-dev`已不存在**，同上 |

代码层面这两个服务定义都已经合并进main了（`docker-compose.staging.yml`的`frontend-staging`服务、`docker-compose.dev.yml`的`frontend-dev`服务），**问题完全在"没有一个持续运行的东西负责让它们保持起来"**，不是代码错。

### ZenithJoy（Venus）

| 档位 | 后端 | 数据库 | 前端 |
|---|---|---|---|
| prod | ✅ 5200 | ⚠️ 还连`cecelia`库，**故意没切**独立`zenithjoy`库（双写验证期到2026-07-16，这是已有决策 `3ac02755`，不是漏做） | 已有HK静态站点 |
| staging | ❌ 5201连不上 | ✅ `zenithjoy_staging`库已建好(111条migration) | 已有HK静态站点 |
| dev | ✅ 5202（`com.zenithjoy.api.dev` LaunchDaemon，`state=running`） | ✅ `zenithjoy_dev`库已建好(111条migration) | 无（本来也没要求做，ZenithJoy只要后端+库） |

ZenithJoy staging(5201)连不上是**我在做"ZenithJoy staging独立库"任务时就已经发现的既有问题**（launchd LaunchAgent找不到该label），当时的handoff（`docs/handoffs/202607140245-dcd4adbf.md`）没有提及是因为那个任务范围不包括修staging宕机——这是遗留债务，另案处理。

---

## 新session要做的事（按优先级）

### P0：Cecelia staging/dev前端重新拉起来，且要用不会被清理的方式

**不要重复我这次的错误**：不要用"临时worktree起容器再删worktree"的模式。正确做法二选一：

**方案A（推荐，最省事）**：让 `staging-deploy.sh`/`dev-deploy.sh` 顺带管这两个前端服务。`staging-deploy.sh` 现在跑的是 `docker compose -f docker-compose.staging.yml up -d`（不带具体service名，理论上会把文件里所有service都reconcile，包括我加的`frontend-staging`）——**先确认这两个部署脚本本身有没有正常把frontend-staging/frontend-dev一起拉起来**，如果确认脚本本身没问题，那大概率是"worktree收割器"把它们清了，需要手动从`/Users/administrator/perfect21/cecelia`主仓库（不是临时worktree、不会被删）重新 `docker compose -f docker-compose.staging.yml up -d`、`docker compose -f docker-compose.dev.yml up -d`，然后观察它们能不能扛过下一轮自动重部署。

**方案B（如果A验证后发现staging-deploy.sh确实没管这两个服务）**：把 `frontend-staging`/`frontend-dev` 的拉起动作显式写进 `staging-deploy.sh`/`dev-deploy.sh`，让它们跟着每次部署一起被reconcile，而不是靠一次性手动`docker compose up`。

### P1：坐实"worktree收割器"是不是真凶

查 `worktree-reaper-active-issue.md` 里提到的判据逻辑（是主仓库git status守卫，还是别的扫描机制），对照本次容器labels（如果还能从docker事件日志/系统日志里找到`cecelia-frontend-staging`/`cecelia-frontend-dev`被删除的时间点和触发者）。如果实锤是这个机制，需要判断：这个机制该不该管Docker容器（目前memory描述的这个reaper主要针对git worktree目录本身，管到Docker容器可能是意外的连带效应，值得单独立一条Notion issue）。

### P2：ZenithJoy staging(5201)为什么连不上

这是独立于本次三档分离工作的旧问题，之前只是绕过没有修。查 `launchctl list | grep zenithjoy` 确认该LaunchAgent到底有没有被加载过；如果从来没加载，找该由谁/哪个流水线负责起它。

### 不需要做的事（已确认是故意的，不是bug）

- ZenithJoy prod数据库还连`cecelia`库——双写验证期到2026-07-16，到期后按 `scripts/zenithjoy-db-compare.sh` 连续核对结果决定是否正式切，走完整/dev流程，不要提前切
- Cecelia各档后端/数据库层——这层是真的稳，本次验证反复确认过

---

## 数据源

- `docs/handoffs/202607140930-0935f962-initiative-handoff.md`（上一份，07-14 09:30，本次接续的起点）
- `docs/handoffs/202607140245-dcd4adbf.md`（补做migration341）
- `docs/handoffs/202607140333-aeeceb8d.md`（ZenithJoy staging独立库）
- `docs/handoffs/202607140503-49dce6cd.md`（Cecelia dev独立前端——**这份说"完成"但实际已漂移，参考时以本handoff为准**）
- `docs/handoffs/202607140651-4cb704b5.md`（ZenithJoy dev后端+库）
- memory `worktree-reaper-active-issue.md`（P0根因排查起点）

## 产物指针（本次5个已合并PR，代码层面都是对的）

- cecelia#3865 — 补做migration341
- zenithjoy-workspace#1293 — ZenithJoy staging独立库
- cecelia#3871 — Cecelia staging独立前端（**服务定义在main了，但运行时容器没了**）
- cecelia#3873 — Cecelia dev独立前端（**同上**）
- zenithjoy-workspace#1295 — ZenithJoy dev后端+库（**这个还活着，因为是系统域LaunchDaemon不是临时worktree起的docker容器**）

## 给新session的一句话总结

**代码全部合并、DB全部建好，这部分是真的**。**运行时状态不可信，必须重新curl验证，尤其Cecelia staging/dev两个前端5212/5213**。别用临时worktree起长期服务，这是这次的教训。
