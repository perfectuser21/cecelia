# PRD：交付轴 Golden Path — 合并即上线（Gate3 假跳过根治 + 部署漂移哨兵 + 每日演习）

- 日期：2026-07-16（草案 v1，待 Alex 过目后立项）
- 决策依据：5b0690ca（golden path 组织修复）、145014a4（无等级不成验/四层路径）
- 弹药：07-14~16 实战 4 次人肉部署尸检——Gate3 假跳过（squash merge 后 `--changed` 为空误判"无改动"跳过真部署，Notion 三连发 P1）；A8-3 因链未部署卡死 4h；缺 zod 被蓝绿闸拦（闸好使，判据坏）
- 定位：三条系统 golden path 的最后一条（生产轴 harness ✅ / 存活轴 A8 ✅ / **交付轴 = 本 PRD**）

## 1. Golden Path 定义（ability：合并即上线）

**入口**：一个改 Brain 代码的 PR 在 GitHub 真 MERGED。
**出口**：≤15 分钟内，生产容器跑着**恰好这个 commit** 的代码，冒烟全绿，账有记录。全程零人工。

```
S1 感知    merge 事件被收到（webhook 或轮询兜底）
S2 判变    该不该部署——【根治点】判据从"--changed 文件列表"换成【SHA 对账】：
           origin/main HEAD SHA vs 生产容器内建入的 GIT_SHA 标签；不等 = 必须部署。
           squash/rebase/合并方式无关，文件列表解析永久退役（假跳过根因）。
S3 构建    镜像构建，GIT_SHA 烙进镜像（build arg → env/label）
S4 预检    green 容器 pre-swap smoke（现有，好使——缺 zod 实战立功，保留）
S5 切换    蓝绿切流（现有，保留）
S6 核验    post-deploy smoke + 【新增】SHA 回读断言：/health 返回的 GIT_SHA == 预期 SHA
           （版本号可以骗人——A 系列没 bump 版本照样上线；SHA 不会）
S7 收账    deploy record 落库（sha/耗时/冒烟结果）+ 失败 Bark
S0 漂移哨兵（常驻横切）：每 30min 对账 origin/main SHA vs 生产 GIT_SHA，
           不一致超过 30min = 有 merge 没上线 → 自动触发部署（webhook 漏了它兜底）；
           连补 2 次仍不一致 → Bark。深度防御：S1 感知层坏了，S0 也能自愈。
```

## 2. 测试四件套（决策 145014a4 口径）

- **L1 串链测试**（CI 每 PR）：S1→S2→S3 调用链真走（mock 只在 docker/gh 网络面且复现真实退出码），核心用例=squash merge 场景 SHA 不等 → 必须触发部署（现版本 failing——这就是假跳过的复现测试）；
- **smoke**：部署脚本自带（现有 gate3-brain-deploy-smoke.sh 升级 SHA 断言）；
- **每日演习（金丝雀）**：不造无害 PR（污染历史），改用**对账断言**——每天 09:00 检查"过去 24h 有 merge 的日子，生产 SHA 必须在 merge 后 15min 内跟上"（查 deploy record 时间线），违约 = 演习红 + Bark。零成本、天天验、不污染仓库；
- **等级**：S2/S6 承诺 L2（服务端真验），S0 哨兵自愈行为承诺 L2 + 一次真实弹（立项后手动触发一次假跳过场景验真开火）。

## 3. 成功标准

- 复现测试：模拟 squash merge（--changed 为空）+ SHA 不等 → 部署被触发（现版本 failing）
- 上线后连续 7 天：每个 brain merge 15min 内生产 SHA 跟上，零人工（deploy record 可查）
- S0 哨兵实弹一次：人为跳过 S1（关 webhook）→ 30min 内哨兵自动补部署成功
- 版本防线附带修复：S6 SHA 断言使"版本号没 bump 也能骗过部署"失效（issue 版本防线的止血面）

## 4. 铁律

- 蓝绿/pre-swap/post-deploy 现有机制一律保留不动（实战证明是好闸）
- SHA 对账是唯一判变真相；禁再引入任何"文件列表/路径过滤"类判据
- S0 自动补部署沿用 brain-deploy.sh 全闸路径，禁旁路直切
- 测试禁 mock 真实外部命令行为（gh/docker 退出码语义必须真实复现）

## 5. 交付切分（3 个 harness sprint，串行）

1. **G1 判变换真相**：GIT_SHA 烙镜像 + S2 SHA 对账判据替换 + S6 回读断言 + squash 复现 failing test
2. **G2 漂移哨兵**：S0 常驻对账 + 自动补部署 + 连败 Bark + 实弹验证
3. **G3 每日演习**：deploy record 时间线对账断言进 nightly + 巡检表/SYSTEM_MAP 登记
