# 启动恢复保留外部有头任务所有权

Task: e26040f6-6ce8-4b12-b92f-2f506f8fbc81
GP-Anchor: none(infra)

Brain启动仅能判断本机进程，不能将有持久化headed-session与非空claimer的外部任务当作inline孤儿回队。本次仅保护startup接缝，不改全局外部类型、不改schema/lease回收、不修改353业务源码。

永久回归验证：真实syncOrphan函数保护有主外部任务；真实scratch全行/lease不变，普通brain-local与无owner行为保持，过期claim仍由原lease reaper失效。历史409与调用实例未知保留，未宣称102/103业务通过。
