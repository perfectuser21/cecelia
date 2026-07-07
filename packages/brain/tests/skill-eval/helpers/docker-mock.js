/**
 * Docker Executor 模拟器 — 用于超时强杀测试
 */

export function createMockDockerExecutor() {
  const killed = [];
  const running = new Set();

  return {
    start(containerId) {
      running.add(containerId);
    },
    kill(containerId) {
      running.delete(containerId);
      killed.push(containerId);
    },
    isRunning(containerId) {
      return running.has(containerId);
    },
    killed, // 暴露给测试断言
    running,
  };
}
