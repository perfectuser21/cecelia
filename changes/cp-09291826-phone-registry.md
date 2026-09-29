## Brain {VERSION} — 手机台账 phone_registry：秋米手机活按台账唯一定案，定不下不派

- 迁移 490 新表 phone_registry（serial/昵称/别名/宿主/profile/型号/归属/角色/抖音号/微信/enabled），种子 0929 实测四台（小彩/小白/小黄/小蓝）；GET/PUT /api/brain/phone-registry（PUT 走内部令牌）。决策 432172f7（方案 C：映射是台账数据，代码只查表+核验+查不到退回），任务 b923b1f7。
- 新模块 routing/phone-resolver.js：序列号 → 昵称/别名（须后接 手机/机 或在「设备：」行）→ 技术名 → 抖音号/抖音昵称，只唯一命中定案；只写型号、多台、手机与抖音号冲突一律不定案。
- 秋米路由手机池改读台账（表缺失/为空回退 device_locks）；设备类任务定不下 → 转 blocked(device_unresolved，blocked_until 为空) 不派，中文表「OpenClaw结果」提示写明手机昵称或抖音账号；定案时给 agent 明确的节点/profile/序列号/手机/目标抖音号，并要求开工前 account-current 核对。
