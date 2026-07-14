# cecelia_dev 容器起服务 + dev 误连生产库 guard — 设计

## 背景

Initiative 0935f962（Cecelia×ZenithJoy 三档三件套）Task4。`docker-compose.dev.yml` 里的 `node-brain-dev` 服务（端口5220，`DB_NAME=cecelia_dev`）从未真正启动过。同时 `db-config.js` 已有 `isTest && dbName==='cecelia'` 的测试环境 guard 先例，缺一个对称的 dev 版本。

## 目标

1. `cecelia-node-brain-dev` 容器实际起来且 healthy
2. dev 环境误连生产库（`DB_NAME` 解析结果等于 `cecelia`）时启动直接失败退出

## 架构

**`docker-compose.dev.yml`**：`node-brain-dev` 服务的 `environment` 加一行 `NODE_ENV=development`。

**`packages/brain/src/db-config.js`**：镜像现有 `isTest` guard，新增：
```js
const isDev = process.env.NODE_ENV === 'development';
if (isDev && dbName === 'cecelia') {
  throw new Error('禁止在 dev 环境连接 cecelia 生产 DB。请显式设置 DB_NAME=cecelia_dev');
}
```
放在现有 isTest guard 之后，同样在模块加载时同步抛出（保持现有"import 即校验"的风格一致）。

## 测试策略

- Unit：镜像 `db-config-guard.test.js` 的写法，新增 `NODE_ENV=development` 场景（4个 case：DB_NAME=cecelia_dev正常/DB_NAME=cecelia抛错/NODE_ENV=production不受影响/未设NODE_ENV不受影响）
- 手动验证：`docker compose -f docker-compose.dev.yml up -d node-brain-dev` 起容器，`curl localhost:5220/api/brain/health` 确认 healthy；再手动改容器环境变量 `DB_NAME=cecelia` 验证真的报错退出（proven-to-fire）

## 不包含

- 不改 prod/staging 现有 compose 服务
- 不改 isTest 既有 guard 逻辑
