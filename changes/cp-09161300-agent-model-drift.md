## Brain {VERSION} — 守卫补 agent 级模型漂移检测（6 个本机 embedded 漏网）

- defaults 切跑场池后，media/dev/work-commander/zenithjoy-owner/yujin/suyanqing 六个 agent 有显式 sol 覆盖绕过默认值，仍在 us-vps 本机跑推理——守卫此前只查 defaults 是盲区
- checkConfigDrift 逐个点名 agent 级 sol；restoreConfigShape 一并拉回池（保留 fallbacks 断池兜底）
