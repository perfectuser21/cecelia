/**
 * Immune System Dashboard
 *
 * 免疫系统总览页 - 显示策略统计、隔离区统计、失败签名、最近晋升
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { immuneApi } from '../../api/immune.api';
import type { DashboardData } from '../../types/immune';
import { PolicyStatusBadge } from './components/StatusBadge';
import { RiskBadge } from './components/RiskBadge';

export default function ImmuneDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await immuneApi.fetchDashboard();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Immune System Dashboard</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Immune System Dashboard</h1>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-700 dark:text-red-400">{error}</p>
          <button
            onClick={loadDashboard}
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Immune System Dashboard</h1>

      {/* Policy Statistics */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Policy Statistics</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Link to="/immune/policies?status=draft">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-gray-400 dark:hover:border-gray-500 transition-colors cursor-pointer">
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.policies.draft}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Draft</div>
            </div>
          </Link>
          <Link to="/immune/policies?status=probation">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-amber-400 dark:hover:border-amber-500 transition-colors cursor-pointer">
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.policies.probation}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Probation</div>
            </div>
          </Link>
          <Link to="/immune/policies?status=active">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-green-400 dark:hover:border-green-500 transition-colors cursor-pointer">
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.policies.active}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Active</div>
            </div>
          </Link>
          <Link to="/immune/policies?status=disabled">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-red-400 dark:hover:border-red-500 transition-colors cursor-pointer">
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.policies.disabled}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Disabled</div>
            </div>
          </Link>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.policies.total}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Total</div>
          </div>
        </div>
      </div>

      {/* Quarantine Statistics */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Quarantine Statistics</h2>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3">
            {data.quarantine.total} Tasks
          </div>
          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <div className="flex justify-between">
              <span>Failure Threshold:</span>
              <span className="font-medium">{data.quarantine.by_reason.failure_threshold}</span>
            </div>
            <div className="flex justify-between">
              <span>Manual:</span>
              <span className="font-medium">{data.quarantine.by_reason.manual}</span>
            </div>
            <div className="flex justify-between">
              <span>Resource Hog:</span>
              <span className="font-medium">{data.quarantine.by_reason.resource_hog}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top 10 Failure Signatures */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Top 10 Failure Signatures</h2>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
          {data.failures.top_signatures.length === 0 ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">No failure signatures yet</div>
          ) : (
            data.failures.top_signatures.map((sig, index) => (
              <Link
                key={sig.signature}
                to={`/immune/signatures/${encodeURIComponent(sig.signature)}`}
                className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 dark:text-gray-500 font-mono text-sm w-6">{index + 1}.</span>
                  <span className="text-sm font-mono text-gray-900 dark:text-gray-100">{sig.signature}</span>
                </div>
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{sig.count} times</span>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Recent Promotions */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Recent Promotions (7 days)</h2>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
          {data.recent_promotions.length === 0 ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">No recent promotions</div>
          ) : (
            data.recent_promotions.map((promo) => (
              <Link
                key={promo.policy_id}
                to={`/immune/policies/${promo.policy_id}`}
                className="block p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                      Policy #{promo.policy_id}: {promo.signature}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {promo.simulations} simulations, {(promo.pass_rate * 100).toFixed(0)}% pass rate
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      Promoted: {new Date(promo.promoted_at).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <RiskBadge level={promo.risk_level} />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
