# Universal Map Projection Engine — Knife 0

来源：`docs/prd/2026-08-10-universal-map-projection-engine.prd.md` 第十二节“刀 0：事实池恢复与 freshness 真验火”。

本 Sprint 只交付事实池：恢复 cron 四 scanner；给四类事实补齐 repo、source revision、scanner version；保证按 repo 原子重拍；将默认 freshness budget 收敛为 15 分钟并在查询 API fail-closed。Manifest、Projector、状态聚合、Dashboard 与第二域 manifest adapter 不进入本 PR。

验收以 `contract-dod.md` 为准，并绑定 Brain task `2fb600e9-d733-4469-8804-ce20da17943c`、decision `4bc109e9-3b70-4b17-a1b4-bcd01bfae776`。
