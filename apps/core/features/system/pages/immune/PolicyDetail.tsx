/**
 * Policy Detail Page
 *
 * 策略详情页 - 显示策略完整信息和评估历史
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { immuneApi } from '../../api/immune.api';
import type { Policy, PolicyEvaluation } from '../../types/immune';
import { PolicyStatusBadge } from './components/StatusBadge';
import { RiskBadge } from './components/RiskBadge';
import { EvaluationTable } from './components/EvaluationTable';

export default function PolicyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [evaluations, setEvaluations] = useState<PolicyEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadPolicy();
  }, [id]);

  const loadPolicy = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);
      const [policyData, evalData] = await Promise.all([
        immuneApi.fetchPolicy(parseInt(id)),
        immuneApi.fetchPolicyEvaluations(parseInt(id), 10),
      ]);
      setPolicy(policyData);
      setEvaluations(evalData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load policy');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!policy || !id) return;

    const confirmed = window.confirm(
      `Are you sure you want to disable policy #${policy.policy_id}?\n\nSignature: ${policy.signature}`
    );

    if (!confirmed) return;

    try {
      setDisabling(true);
      await immuneApi.updatePolicyStatus(parseInt(id), 'disabled', 'Manually disabled from UI');
      await loadPolicy();  // Reload policy
    } catch (err) {
      alert(`Failed to disable policy: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDisabling(false);
    }
  };

  const handleEnable = async () => {
    if (!policy || !id) return;

    try {
      setDisabling(true);
      await immuneApi.updatePolicyStatus(parseInt(id), 'active', 'Re-enabled from UI');
      await loadPolicy();  // Reload policy
    } catch (err) {
      alert(`Failed to enable policy: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDisabling(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-700 dark:text-red-400">{error || 'Policy not found'}</p>
          <button onClick={() => navigate('/immune/policies')} className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Back to Policies
          </button>
        </div>
      </div>
    );
  }

  const successRate =
    policy.success_count + policy.failure_count > 0
      ? ((policy.success_count / (policy.success_count + policy.failure_count)) * 100).toFixed(1)
      : 'N/A';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Policy #{policy.policy_id}</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 font-mono mt-1">{policy.signature}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/immune/policies')} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">
            Back
          </button>
          {policy.status === 'active' ? (
            <button
              onClick={handleDisable}
              disabled={disabling}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {disabling ? 'Disabling...' : 'Disable'}
            </button>
          ) : policy.status === 'disabled' ? (
            <button
              onClick={handleEnable}
              disabled={disabling}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {disabling ? 'Enabling...' : 'Enable'}
            </button>
          ) : null}
        </div>
      </div>

      {/* Basic Info */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Basic Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Status</div>
            <div className="mt-1">
              <PolicyStatusBadge status={policy.status} size="md" showDot />
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Risk Level</div>
            <div className="mt-1">
              <RiskBadge level={policy.risk_level} size="md" />
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Success Rate</div>
            <div className="mt-1 text-lg font-medium">
              {successRate}% ({policy.success_count}/{policy.success_count + policy.failure_count})
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Created</div>
            <div className="mt-1 text-sm">{new Date(policy.created_at).toLocaleString('zh-CN')}</div>
          </div>
          {policy.promoted_at && (
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Promoted</div>
              <div className="mt-1 text-sm">{new Date(policy.promoted_at).toLocaleString('zh-CN')}</div>
            </div>
          )}
        </div>
      </div>

      {/* Policy JSON */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-3">Policy Content</h2>
        <pre className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 overflow-x-auto text-sm">
          {JSON.stringify(policy.policy_json, null, 2)}
        </pre>
      </div>

      {/* Evaluation History */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-3">Evaluation History (Latest 10)</h2>
        <EvaluationTable evaluations={evaluations} />
      </div>
    </div>
  );
}
