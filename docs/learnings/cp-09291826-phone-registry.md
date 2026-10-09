# 手机昵称查不到 → agent 卡住或用错手机（09-29）

### 根本原因
- 「小黄/小彩/一号机/抖音号」→ 手机 的映射只存在于执行机的 douyin-phone-profiles.tsv 和人脑里，Brain 路由只认序列号子串；任务写昵称时 device_hint.serial 为空，agent 按提示自己去 tsv 猜，猜不到就卡、猜错就用错手机写错数据。
- 「型号 MAA-AN00」被当作身份线索，但同型号有三台。

### 下次预防
- [ ] 手机映射一律进 phone_registry 台账（PUT /api/brain/phone-registry），不在代码/提示词里写死任何一台手机
- [ ] 碰真机的任务只有台账唯一命中才派；定不下转 blocked(device_unresolved) 并在中文表提示，不让 agent 猜
- [ ] 型号只作线索，永不单独定案
