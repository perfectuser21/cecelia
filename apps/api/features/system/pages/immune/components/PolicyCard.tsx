/**
 * Policy Card Component
 *
 * 策略卡片 - 显示策略概览信息
 */

import React from 'react';
import { Link } from 'react-router-dom';
import type { Policy } from '../../../types/immune';
import { PolicyStatusBadge } from './StatusBadge';
import { RiskBadge } from './RiskBadge';

interface PolicyCardProps {
  policy: Policy;
  onClick?: () => void;
}

export function PolicyCard({ policy, onClick }: PolicyCardProps) {
  const successRate =
    policy.success_count + policy.failure_count > 0
      ? ((policy.success_count / (policy.success_count + policy.failure_count)) * 100).toFixed(0)
      : 'N/A';

  const CardContent = (
    <div
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-blue-500 dark:hover:border-blue-500 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">#{policy.policy_id}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 font-mono">{policy.signature}</p>
        </div>
        <div className="flex flex-col gap-1.5 items-end">
          <PolicyStatusBadge status={policy.status} />
          <RiskBadge level={policy.risk_level} />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mt-3">
        <div>
          Success: {policy.success_count} / Failures: {policy.failure_count}
        </div>
        <div>Rate: {successRate}%</div>
      </div>

      <div className="text-xs text-gray-400 dark:text-gray-500 mt-2">
        Created: {new Date(policy.created_at).toLocaleString('zh-CN')}
      </div>
    </div>
  );

  if (onClick) {
    return CardContent;
  }

  return <Link to={`/immune/policies/${policy.policy_id}`}>{CardContent}</Link>;
}
