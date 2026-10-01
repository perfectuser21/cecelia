import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

// 从测试文件自身定位 repo root——process.cwd() 会随跑测的 package 变化
// （brain-unit 的 cwd=packages/brain，用 cwd 解析必炸；#4038 合入时 brain-unit 未触发所以没暴露）
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

// 封装为 async 函数，满足 lint-test-quality 规则（await fn() 调用）
async function readSourceFile(relativePath: string): Promise<string> {
  return readFile(resolve(REPO_ROOT, relativePath), 'utf-8')
}

async function getManifestRoutes(relativePath: string): Promise<Array<{ path: string; component?: string; redirect?: string }>> {
  // 加载真实 manifest，避免正则把父路由与嵌套导航 children 混在一起。
  const { default: manifest } = await import(resolve(REPO_ROOT, relativePath))
  return manifest.routes
}

describe('OwnerCockpit 路由接线 — 防孤儿断言', () => {
  it('App.tsx 顶层静态含 OwnerCockpitPage 引用（防孤儿断言）', async () => {
    const content = await readSourceFile('apps/dashboard/src/App.tsx')
    expect(content).toContain('OwnerCockpitPage')
  })

  it('根路由进入交代入口，Overview 仍挂载 OwnerCockpit（防孤儿 manifest 断言）', async () => {
    const routes = await getManifestRoutes('apps/api/features/dashboard/index.ts')
    const rootRoute = routes.find(r => r.path === '/')
    expect(rootRoute).toBeDefined()
    expect(rootRoute?.redirect).toBe('/workbench/inbox')

    const workbenchRoutes = await getManifestRoutes('apps/api/features/workbench/index.ts')
    expect(workbenchRoutes.find(r => r.path === '/workbench')?.redirect).toBe('/workbench/inbox')
    expect(workbenchRoutes.find(r => r.path === '/workbench/inbox' && r.component)?.component).toBe('WorkbenchInbox')
    const overviewRoute = workbenchRoutes.find(r => r.path === '/workbench/overview' && r.component)
    expect(overviewRoute).toBeDefined()
    expect(overviewRoute?.component).toBe('WorkbenchOverview')

    const workbenchManifest = await readSourceFile('apps/api/features/workbench/index.ts')
    expect(workbenchManifest).toContain("WorkbenchInbox: () => import('../gtd/pages/GTDInbox')")
    expect(workbenchManifest).toContain("WorkbenchOverview: () => import('../../../dashboard/src/pages/owner-cockpit/OwnerCockpitPage')")
  })
})
