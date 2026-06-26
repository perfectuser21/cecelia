/**
 * HarnessPipelineStatus — Harness 工厂线贯通固定状态标识
 *
 * 首页常驻可见的静态标识，逐字固定文字 "Cecelia Harness 工厂线已贯通"。
 * 不依赖任何接口数据/认证状态：无条件渲染，接口异常/空状态不影响显示。
 * 固定底部右下角，emerald 底 + 白字，暗/亮主题下均清晰可见。
 */
import type { FC } from 'react';

// 逐字固定文字，禁止同义改写（contract: harness-pipeline-status）
const FIXED_TEXT = 'Cecelia Harness 工厂线已贯通';

const HarnessPipelineStatus: FC = () => {
  return (
    <div
      data-testid="harness-pipeline-status"
      className="fixed bottom-3 right-3 z-50 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-600 text-white shadow-md"
    >
      {FIXED_TEXT}
    </div>
  );
};

export default HarnessPipelineStatus;
