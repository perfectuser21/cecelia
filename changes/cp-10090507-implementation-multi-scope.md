## Brain {VERSION} — 受信快照伴随来源驱动的联合PR入口

- 自仓PR使用精确版本1 `cecelia-kr` / `cecelia-factory` 来源；新增可选输入保持原6个required输入，MODE/main单scope发布路径及固定8e54条件runner字节不变。
- 官方snapshot-main仍只保存原head.json/base.json；PR下载同一正式main来源artifact后，通过已正规发布的pr-gate提取严格Factory companion，不请求不存在的head-scope文件、不把缺失或UNKNOWN变成联合准入。
- 真下载shell调用真实受审CLI：缺companion保准确UNKNOWN且不产联合文件/PASS；PG十一项保全部原十项及实际PR/main条件shell回归，每scope固定回归独立运行。
- 仅native KR/Brain同repo/revision来源组合受支持；Workspace跨repo伴随协议仍拒绝，不改consumer执行权限或中央current/status/refs。
- 同base的多份正规artifact按真实created_at排序（ID仅同时间确定性次序），不把API首项或较大ID当新来源，不按body绿过滤或回退旧源。永久实际shell回归重现ID/创建时间倒序。
