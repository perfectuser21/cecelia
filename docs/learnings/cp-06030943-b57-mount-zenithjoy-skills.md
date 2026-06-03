# Learning: B57 — brain 容器缺 zenithjoy-skills mount，harness SKILL 全加载失败

### 根本原因
brain 跑 /app 镜像代码，loadSkillContent 的 SKILL_SEARCH_DIRS：
1. 前 3 路径 `~/.claude*/skills/<name>` 在 host 是 **symlink → ~/perfect21/zenithjoy-skills**，但 docker-compose 只 mount 了 `.claude`、没 mount `zenithjoy-skills` → 容器内 symlink 悬空不可达。
2. 第 4 路径 `packages/workflows/skills`（相对 import.meta.url）在 /app 扁平镜像里解析成 `/workflows/skills`（不存在）。

→ 4 路径全 miss。B56 前返回空串：**所有 harness agent（planner/proposer/reviewer/generator/evaluator/report）一直用空 SKILL 凑合跑**，GAN 凑出看似合理的 PRD/合同，generator 凑合时漏 commit/PR 才暴露。B56 fail-fast 把这个被掩盖很久的系统性根因逼现。

### 下次预防
- [ ] 容器化服务依赖 host symlink 时，symlink 的**目标**也必须 mount（不只 mount symlink 本身所在目录）
- [ ] 镜像扁平化 COPY（packages/brain/src → /app/src）会破坏 monorepo 相对路径假设（../../workflows），SKILL/资源路径应用绝对路径或 env，不依赖 import.meta.url 相对解析
- [ ] 关键资源加载失败必须 fail-fast（B56）——否则空值凑合会把配置错误伪装成"能跑"，掩盖根因数周
- [ ] 部署后应有 smoke：验证容器内 loadSkillContent 6 个 harness SKILL 都能加载非空
