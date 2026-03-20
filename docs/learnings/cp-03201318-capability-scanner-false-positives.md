# Learning: Capability Scanner 孤岛能力误报修复

## 背景

Brain Self-Drive 系统报告"2个失败的能力"，经调查发现 Capability Scanner 误报了13个实际运行的能力为"孤岛"状态。主要问题是扫描器缺乏对运行服务和基础设施组件的检测能力。

## 问题分析

### 根本原因

1. **检测范围局限性**: Capability Scanner 仅依赖数据库中的使用记录（tasks、run_events、cecelia_events），无法识别通过其他方式运行的服务和基础设施
2. **BRAIN_ALWAYS_ACTIVE 覆盖不足**: 缺少 cecelia-dashboard 和 postgresql-database-service 等关键基础服务
3. **缺乏运行时检测**: 没有端口检测机制验证 Web 服务实际运行状态
4. **缺乏文件系统检测**: 没有检查 Hooks 和脚本文件存在性来判断功能可用性

### 技术细节

**误报能力类型**:
- Web 服务类: cecelia-dashboard (端口5211运行但数据库无记录)
- 基础设施类: postgresql-database-service (Brain 核心依赖)
- 文件系统类: branch-protection-hooks (有大量相关文件但无 events 记录)
- CI/DevGate类: ci-devgate-quality (脚本存在且工作但缺乏使用跟踪)

**解决方案**:
1. 扩展 BRAIN_ALWAYS_ACTIVE 白名单
2. 添加端口检测逻辑 (section 5.15)
3. 添加文件系统检测逻辑 (section 5.16)
4. 使用 fetch + AbortSignal.timeout 进行服务健康检查
5. 使用 existsSync 进行文件存在性验证

## 实现重点

### 端口检测实现
```javascript
const portCheckMap = {
  'cecelia-dashboard': 5211,
  'zenithjoy-dashboard': 5211,
};

const response = await fetch(`http://localhost:${port}`, {
  method: 'HEAD',
  signal: AbortSignal.timeout(2000)
});
```

### 文件系统检测实现
```javascript
const fileCheckMap = {
  'branch-protection-hooks': [
    'packages/engine/hooks/branch-protect.sh',
    'packages/engine/hooks/stop.sh'
  ],
  // ...
};

const expandedPath = filePath.startsWith('~')
  ? filePath.replace('~', process.env.HOME || '~')
  : filePath;
if (existsSync(expandedPath)) {
  health.status = 'active';
}
```

## 效果验证

DoD 验收条件覆盖:
- [x] BRAIN_ALWAYS_ACTIVE 更新 (cecelia-dashboard, postgresql-database-service)
- [x] Web 服务检测逻辑 (fetch + localhost 检查)
- [x] 文件系统检测逻辑 (existsSync + hook 文件检查)
- [x] 手动触发扫描验证孤岛能力减少
- [x] 验证特定能力状态转为 active

### 下次预防

- [ ] **监控检测覆盖度**: 定期审查新增能力是否需要特殊检测逻辑
- [ ] **自动化检测扩展**: 考虑基于能力 scope 字段自动推断检测方法
- [ ] **检测结果审计**: 建立机制定期验证检测准确性，避免漏检和误报
- [ ] **文档同步**: 新增能力时同步更新检测规则和白名单配置
- [ ] **错误处理增强**: 为端口检测和文件检测添加更详细的错误日志
- [ ] **检测性能优化**: 考虑并发检测和缓存机制提升大规模扫描性能
- [ ] **检测方法标准化**: 建立能力检测方法的分类标准和最佳实践

## 关键学习点

1. **多维度检测的重要性**: 单一数据源无法覆盖所有运行模式，需要数据库记录 + 运行时检测 + 文件系统检测的综合方案
2. **基础设施可见性**: 数据库、Web 服务等基础组件虽然重要但往往在监控盲区，需要显式配置
3. **检测超时设置**: 网络检测必须设置合理超时避免阻塞扫描流程
4. **路径处理规范**: 文件检测需要正确处理 ~ 路径扩展和相对/绝对路径

## 技术债务

- 当前检测逻辑硬编码在 portCheckMap 和 fileCheckMap 中，未来应考虑配置化
- 检测失败时的降级策略需要进一步完善
- 检测结果的持久化和历史趋势分析有待增强