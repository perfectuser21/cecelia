# Hand-off：Cecelia — 部署流程对齐 + staging 访问（私密）+ gate 实跑验证（最终版 2026-06-25）

> 目标 repo：`cecelia`。执行：Agent Teams 直接驱动（不走 harness）。PR 留绿给用户合。
> 一句话：Cecelia 部署机制已健康（无 ZenithJoy 那个 release 洞），按"main→staging→人工放行→prod"对齐，补一个**只你自己看的私密 staging 网址**（不给同事看，所以不上 Cloudflare 邮箱闸）。

---

## 0. 拓扑事实
- **跑 Claude 的这台机器就是 mmv**；Cecelia 全部跑在 mmv 上（dashboard 容器 `perfect21:5211` 走 OrbStack + Brain `localhost:5221`）。
- Cecelia 是**内部工具、唯一用户=你**，无付费客户。

## 1. 目标流程
```
generator 写 → 便宜 CI → 合 main（= staging 候选，不是生产）
   ↓ 自动
staging（mmv 上一个非生产端口，有可打开的网址，部署前自检在这跑）
   ↓ 自检绿
★人工放行★：你打开 staging 网址看一眼 → 手点放行
   ↓
promote → 5211 + HK 生产
```
> 与 ZenithJoy 唯一区别：① Cecelia 部署机制**已隔离**（build→`.dist-staging`→原子 swap），不需要 ZenithJoy 那套 release 目录重构；② Cecelia 只你自己看，**访问只走 SSH 隧道，不配 Cloudflare 邮箱闸**。

## 2. staging 访问方式（已定）
| 谁看 | 怎么看 | 要装啥 |
|---|---|---|
| **只你自己** | SSH 隧道 + 端口转发：`perfect21:52xx`（cloudflared ssh 进 mmv + `LocalForward` + hosts） | 1Password 的 ROGSSH 钥匙 |
- **不配 Cloudflare Access / 邮箱闸**——Cecelia 不给同事看，这是与 ZenithJoy 的区别。
- Cecelia **不需要对外公网生产**：你 dev/staging/生产全从 `perfect21` 私密看就够（HK 实例更像备份，非客户面）。

## 3. 已完成（基础）
- PR #3412（已合并 main）：staging slot + dashboard 部署前自检 gate；`deploy-local.sh` build→`.dist-staging`（不碰 live dist/）→ 自检 → 全绿才原子换入 live dist/ + tar+ssh 同步 HK。**已做对隔离，ZenithJoy 要抄这套。**

## 4. 要做的

### 1) 加可打开的 staging 网址（私密）+ 人工放行闸
- 把 `.dist-staging` 产物**起在一个非生产端口上**（如 `52xx`），让你走 `perfect21:52xx` 隧道能打开看。
- 部署改两段：自检绿 → **停住等你手点放行** → 才 promote（原子换入 5211 + tar+ssh 同步 HK）。**不再自检绿就自动 promote。**
- 交付带一份人工验证 instruction（打开 `perfect21:52xx`，看 X/Y/Z）。

### 2) 在一次真实部署里验证 gate（原缺口）
- 触发一次真实 dashboard 部署（改 `apps/dashboard/**` 无害改动）走 `deploy-local.sh` 全链路。
- happy path：自检绿 → 你放行 → promote → **5211 与 HK 公网首页都 200**。
- proven-to-fire（真实链路级）：弄一个会让自检失败的改动 → 断言 **promote 不可达、5211 与 HK 都没变、报红**。
- 确认 promote **两个实例都真更新**（不只本机 5211）。

## 5. 不做
- 完整蓝绿 / 流量切换 / 常驻双实例 / HK staging。
- 不照搬 ZenithJoy 的 release 目录重构（Cecelia 已隔离）。
- **不配 Cloudflare Access / 邮箱闸**（不给同事看）。

## 6. 验收标准
- [ ] `perfect21:52xx` 能打开看 Cecelia dashboard 新版（私密、走隧道）。
- [ ] 部署停在自检绿处等你放行，你点了才 promote。
- [ ] 真实部署：放行 → 5211 + HK 都 200。
- [ ] proven-to-fire（真实链路）：自检失败 → 两生产实例纹丝不动 + 报红。
- [ ] 确认 promote 同时更新 5211 与 HK。
- [ ] CI 全绿，PR 留绿给用户合。

## 7. 纪律
- 不 push main、不 admin merge；独立 worktree（cp-* 8位时间戳分支）；push 前核对 commit 集。
- 改部署/CI 配置的 PR 标题加 `[CONFIG]`；E2E-first 两次 commit。
