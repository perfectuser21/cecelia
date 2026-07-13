// Re-export from api features — implementation lives in apps/api/features/execution/pages/RelayProgressPage
// Tests import this file directly; runtime loads via DynamicRouter → coreConfig.pageComponents
export { default, stripPhasePrefix } from '@features/core/execution/pages/RelayProgressPage';
