# 树 + 仓库 定稿 v3.0：两样东西、两张表的列、两条路

> 替换 v2.0。v2.0 加的「做法」层撤销（Steps 回到 Activity 底下，按标准）。
> 主理人 2026-10-05 对话定稿：只有树和仓库；Activity 写"要做到什么"，Steps 写"怎么一步步做"；两者都由机器写，人只拍板三问。

## 1. 只有两样东西

```
树：部门 → 价值流 → 能力 → 流程 → Activity
                                   ├ 验收 8 列（颜色在 activity_cells）
                                   ├ Steps（activity_id 指回来，一对多）
                                   └ 用仓库的哪几件（activity_uses）

仓库：warehouse_items 一张表，shelf 八个货架：平台动作 / 通用动作 / 数据 / 服务 / 界面 / 基础设施 / 外部依赖 / 账号与密钥
```

- 顺序不在 Activity 上：同一个 Activity 在不同流程里位置不同，顺序在 `workflow_activity_refs`（workflow_id, activity_id, sequence_no）。
- 执行记录 `spans` 是第四本账，每跑一次 Activity 一行、每个 Step 一行。
- 没有第三样东西。"线"= Activity 的 uses 字段；"做法"= uses 指向的那件料；"证据"= spans。

## 2. Activity 与 Step 怎么分

| | Activity | Step |
|---|---|---|
| 判据 | 有外面能看见的结果；能单独排进流程；失败要有人知道 | 为完成 Activity 的机械动作；失败没人单独关心它 |
| 三问 | 用户会单独要它吗？能单独排进流程吗？失败要单独通知人吗？ | 三问皆否 |
| 写什么 | 要做到什么（承诺、失败语义、不变量、验收） | 怎么做（动作、进出、读回） |
| 失败处理 | 写在这里（致命/可重试/空结果/要人） | 只写 retry 几次 / abort，其余查 Activity |

## 3. Activity 的列（15 列 + 机器列）

| 列 | 谁写 | 写什么 |
|---|---|---|
| key, name | 机器 | `<workflow_key>.<activity_key>`，名字 |
| promise | AI 起草，**主理人拍板** | 一句话承诺，用户或运维语言 |
| inputs, outputs（jsonb） | 机器 | 进什么、出什么、改哪张表 |
| preconditions（jsonb） | 机器 | 开始前必须成立 |
| invariants（jsonb） | 机器 | 全程不能破 |
| nfr（jsonb） | 机器 | 时限、频控、规模 |
| failure（jsonb） | AI 起草，**要人的档主理人拍板** | fatal / retryable / empty_ok / needs_human |
| readback（jsonb） | 机器 | 做完去哪看、看到什么算成 |
| judgment（jsonb） | AI 起草，**误判后果主理人拍板** | 对模糊现实怎么判、误判后果 |
| adversarial（text） | AI 起草 | 谁会来搞、怎么搞 |
| executor_kind | 机器 | code / agent / human |
| shelf_life_days | 机器（默认按流程频率） | 多久没验要重验 |
| uses | 机器 | 用仓库的哪几件（`activity_uses` 表） |
| contract, contract_sha256, version, status, notion_* | 机器 | 快照、版本、状态、镜子 |

8 个验收列各一格：promise / nfr / judgment / invariants / failure / readback / adversarial / shelf_life。格子颜色与探针在 `activity_cells`（每个 Activity 固定 8 行）。场景检查（断网/重启/洪峰）是 readback 的子项，不另开格。

## 4. Step 的列（8 列）

| 列 | 谁写 | 写什么 |
|---|---|---|
| activity_id, step_order | 机器 | 属于哪个 Activity、第几步 |
| key, name | 机器 | 稳定键、名字 |
| action | 机器 | 这一步做的动作，按脚本精度 |
| inputs, outputs（jsonb） | 机器 | 进什么、出什么 |
| readback（jsonb） | 机器 | 读回什么算这一步过 |
| on_fail | 机器 | retry N / abort |
| mode | 机器 | action / checkpoint / wait |

Step 上没有承诺、不变量、通知人。

## 5. 两条路，谁写什么

### 路 A：代码先行（需求 → 合同 → 代码）
```
① 主理人一句需求
② /capability 归位：能力 → 流程 → 新 Activity 还是改旧的
③ AI 起草合同：Activity 15 列 + Steps 8 列，写进仓库里的合同文件
④ 主理人答三问：承诺对不对 / 哪些失败要人 / 判定点误判后果受不受得了
⑤ /dev 写代码：每个 Step 的 readback 就是代码里的断言；合同同步把 Activity/Steps 登记进库；不写 readback 不许过
⑥ 跑 → spans → 8 格判色 → 连续 N 次绿 = 固化
```

### 路 B：探索先行（AI 先跑通 → 沉淀 → 蒸馏成脚本）
```
① 主理人一句话，OpenClaw 用技能先跑
② 技能每做一步发一条 spans（进什么、出什么、看到什么）
③ 跑通一次 → 沉淀技能读 spans + SKILL.md，起草 Activity 15 列 + Steps 8 列，登记为候选
④ 主理人答同样三问
⑤ 再跑 N 次：spans 与 Steps.readback 对账，对不上改 Steps，直到稳定
⑥ Steps 稳定 = 脚本规格书 → 技能蒸馏成脚本（决策 ca9f3d7b）→ 脚本按同一套 Steps 跑 → 8 格重判
```

两条路汇到同一张 Activity + Steps。技能换脚本 = 换 uses 指向，Activity、8 列、Steps 不动，8 格重判。

### 主理人只碰三问
承诺对不对；哪些失败要人；判定点误判后果受不受得了。其余全部机器写。

## 6. 现状与定稿的差距（按表）

### activities（现名 journey_steps）
| 定稿列 | 现状 |
|---|---|
| key | 有（activity_key，需补 workflow 前缀） |
| name | 有 |
| promise | 有列，获客线 4/8 空 |
| inputs / outputs / preconditions / invariants / nfr / failure / readback | 都在 `contract` JSON 里，没有列（获客线内容齐，客服线散在格子里） |
| judgment | 无 |
| adversarial | 无（客服线只有格子状态无文字） |
| executor_kind | 有 |
| shelf_life_days | 无 |
| uses | 有（activity_items，改名 activity_uses） |
| contract / version / status / notion_* | 有 |
| 多余列 | step_number（顺序移到 refs 表）、journey_id（由流程推）、capability_key、enabler_id |

### steps
| 定稿列 | 现状 |
|---|---|
| activity_id, step_order, key | 有 |
| name | 在 contract JSON 里 |
| action | 无 |
| inputs / outputs | 无 |
| readback | 有列，**45/45 为空** |
| on_fail | 无 |
| mode | 有，全是 checkpoint |
| 多余列 | activity_key、source_sha256（可留作机器列） |

### activity_cells（现名 journey_step_links）
固定 8 行/Activity 没做；现在格子名两套语言（客服线 FR/NFR…，获客线 stage/regression）；混着 base_ref 用料行。

### 缺的程序
1. 合同模板加 Step 的 action/inputs/outputs/readback/on_fail，/dev 不写不过。
2. 路 B 的沉淀技能；技能按 Step 发 spans。
3. "跑 N 次收敛 Steps"的对账程序。
4. 8 格固定 + 两套格子语言归一的迁移。

## 7. 施工顺序（第二段）
1. 列整形：activities 加 7 列（从 contract 拆）+ judgment/adversarial/shelf_life；steps 加 action/inputs/outputs/on_fail；去多余列。
2. 8 格固定：每 Activity 生成 8 行；旧格子按名字映射；base_ref 迁 activity_uses。
3. 顺序移到 refs 表；代码切名；物理换名；外键收紧。
4. 合同模板与 /dev 闸（路 A）。
5. 沉淀技能 + 技能按 Step 发 spans + 收敛对账（路 B）。
6. 补获客线：4 条承诺、45 条 Step readback，作为样板。
7. Notion：仓库物件库 8 视图、Activity 页带 Steps 子表。

## 8. 待拍板
1. 8 格定死：promise / nfr / judgment / invariants / failure / readback / adversarial / shelf_life。
2. 固化 N 按流程频率：每小时 24 / 每日 7 / 每周 4 / 按需 3。
3. 先补哪条线做样板：建议获客（内容最全，只缺承诺和 Step readback）。
