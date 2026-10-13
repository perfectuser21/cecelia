# 固定来源核验验收

- [x] [BEHAVIOR] skillgitprovenance 临时真实Git仓库验证固定commit、SSH/HTTPS归一、只出摘要、修改/删除/未跟踪/ignore文件拒绝、链接拒绝、凭据remote拒绝及Git环境隔离、禁用refs/replace、目录逃逸、执行权限及读取期HEAD漂移。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/skill-git-provenance.test.js"
