## Brain {VERSION} — 明确多领域来源的PR联合准入

- scripts/ci/implementation-pr-gate.mjs 保留默认单领域正式验收，新增只收集完整差异原生报告的接口；新 implementation-multi-pr-gate.mjs / implementation-multi-scope.mjs 按明确冻结来源生成联合准入证据。
- 每个scope保留实际投影/定义/原生调用/回归；完整Git差异逐文件覆盖，foreign缺归属仅由另一领域真实原生闭包说明，图/owner/断言UNKNOWN保留。每领域固定测试真实执行，联合receipt不冒业务运行成功。
- workflow新增可选 admission_scopes JSON版本1协议，默认6required inputs原样，只有显式PR联合admission；main仍原单领域release。scoped快照须同一正规main artifact内固定repo/SHA来源，未知快照不准入。
