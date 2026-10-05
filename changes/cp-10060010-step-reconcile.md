## Brain {VERSION} — 树+仓库 v3.0 第 4 刀（路 B）：技能按 Step 发 span、沉淀成候选 Activity、收敛对账

- 任务 3590ec8f：探索先行的那条路补上程序。技能每做完一步发一条 Step span（`scripts/emit-step-span.mjs`，证据约定 `step_key / name / action / reads / writes / observed`，走现成的 `POST /api/brain/spans`）。
- 收敛对账（`lib/step-reconcile.js`，`POST /api/brain/step-reconcile/:activityId`）：把最近 N 次运行里每个 Step 的观测值按 `Steps.readback` 求值，逐次判已验证 / 对不上 / 未验证 / 失败 / 缺失 / 跳过 / 豁免，抓出合同没声明的 Step；连续 N 次整个 Activity 全绿 = 收敛（可以固化），并把 `readback` 格翻绿，对不上翻红，收敛中待判，没数据不动。拿不到观测值一律「未知」，不猜通过。
- 读回求值（`lib/step-readback-eval.js`）：支持合同的 `== >= <= not_null_all`，另加 `!= > <`。
- 沉淀技能（`lib/skill-settlement.js`，`POST /api/brain/skill-settlement/draft` 与 `/register`）：读 spans + SKILL.md 起草 Steps（名字/动作/进出取自 span；读回只在各次观测值一致且跑过两次以上才起草 `==`；失败处理只由重试/失败痕迹推出），登记为 `candidate` 状态的 Activity：承诺列保持空、固定 8 个灰格、一条待拍板（三问：承诺对不对 / 哪些失败要人 / 判定点误判后果，72 小时不答按默认走）。同一 能力.活动 重复登记不覆盖。
- 未做（刻意）：新 Activity 经合同同步插入时补 8 灰格，等 Step 同步那个 PR 合并后再接，避免两个 PR 改同一个文件。
