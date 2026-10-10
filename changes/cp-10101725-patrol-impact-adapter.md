## Brain {VERSION} — 手机巡查独立固定Git来源准入

### 手机巡查独立来源准入（任务 a8448b2b，迁移544）

`cecelia-device-patrol` 仅允许系统看护·设备与手机台账中已登记的单手机/批次Workflow。内部认证 `POST /implementation-ci/device-patrol/bootstrap` 从固定仓库GitHub读取Git树与blob，核SHA1/长度及base祖先，证明base没有巡查路径后保存不可变引入账；现存completed Workflow authoring回执及有序Activity身份必须一致。定义版本标为device_workflow_admission，合同executable=false，不拨发布线生产指针。固定Git CI窄gate逐文件核绑定/辅助来源/开发交付治理并运行真实回归；旧scope协议保留。此账只证明源码准入，不证明手机实际执行或Run绑定。

首次引入账与canonical当前定义/source/ref版本相隔离；Git声明版本只含来源声明，当前合同摘要及authoring回执另作canonical_reference。可信工具main的Implementation impact独立巡查baseline job只读导出固定73bd/f092来源身份；巡查分支严格核发布工具SHA、成功main run、workflow路径、artifact SHA256，PR不持Brain写token。后继实际BASE逐棵Git全树证明phone前缀不存在，HEAD逐blob与真实断言验证，源身份账不充当HEAD执行证明。
