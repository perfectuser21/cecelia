# Contract DoD — Golden Path 断言盖章 WarRoom

- Decision: `df68e4fc-8428-4efb-9dd4-b4677dc06dee`
- Scope: 定版 PRD §④-1 展示层

## [BEHAVIOR] U-01：纸面绿格不冒充已验证

`cell_status=green` 但 `verification.state=never_run` 的格子显示为灰色“仅纸面
断言”；只有 API 返回 `verification.verified=true` 才显示绿色“已执行验证”。

Test: manual:bash `npm --prefix apps/dashboard run test:run -- src/pages/warroom/__tests__/WarRoomGoldenPathPage.test.tsx`

## [BEHAVIOR] U-02：覆盖率完全使用 Brain 计算结果

WarRoom 显示 API `coverage` 的 eligible、verified、percent，不在前端另算；
decision、evaluation 与 N/A 显示语义状态但不伪造覆盖。

Test: manual:bash `npm --prefix apps/dashboard run test:run -- src/pages/warroom/__tests__/WarRoomGoldenPathPage.test.tsx`

## [BEHAVIOR] U-03：部分失败明确不可用

页面通过复数 Golden Path API 定位 GP，再读取有序 journey steps 和每步
ledger。任一 ledger 请求失败时显示“账本数据不可用”，不得显示灰格或 0%。

Test: manual:bash `npm --prefix apps/dashboard run test:run -- src/pages/warroom/__tests__/WarRoomGoldenPathPage.test.tsx`

## [BEHAVIOR] U-04：状态可访问且移动端可用

格子标签同时表达步骤、区域、业务状态和验证状态；图标按钮具有可访问名称，
键盘可达；Dashboard 生产构建通过。

Test: manual:bash `npm --prefix apps/dashboard run build`
