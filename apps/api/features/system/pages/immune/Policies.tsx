/**
 * Policies List Page
 *
 * 策略列表页 - 支持过滤、排序、分页
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { immuneApi } from '../../api/immune.api';
import type { Policy, PolicyStatus } from '../../types/immune';
import { PolicyCard } from './components/PolicyCard';

export default function PoliciesList() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const statusFilter = (searchParams.get('status') as PolicyStatus | null) || undefined;

  useEffect(() => {
    loadPolicies();
  }, [statusFilter]);

  const loadPolicies = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await immuneApi.fetchPolicies({
        status: statusFilter,
        limit: 50,
      });
      setPolicies(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load policies');
    } finally {
      setLoading(false);
    }
  };

  const handlePolicyClick = (policyId: number) => {
    navigate(`/immune/policies/${policyId}`);
  };

  const filterButtons: Array<{ label: string; value: PolicyStatus | undefined }> = [
    { label: 'All', value: undefined },
    { label: 'Active', value: 'active' },
    { label: 'Probation', value: 'probation' },
    { label: 'Draft', value: 'draft' },
    { label: 'Disabled', value: 'disabled' },
  ];

  const filteredPolicies = statusFilter ? policies.filter((p) => p.status === statusFilter) : policies;

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Policies</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Policies</h1>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-700 dark:text-red-400">{error}</p>
          <button
            onClick={loadPolicies}
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Policies</h1>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {filterButtons.map((btn) => (
          <button
            key={btn.label}
            onClick={() => {
              if (btn.value) {
                navigate(`/immune/policies?status=${btn.value}`);
              } else {
                navigate('/immune/policies');
              }
            }}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              statusFilter === btn.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Policies Grid */}
      <div>
        {filteredPolicies.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            No policies found
            {statusFilter && ` with status "${statusFilter}"`}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPolicies.map((policy) => (
              <PolicyCard key={policy.policy_id} policy={policy} onClick={() => handlePolicyClick(policy.policy_id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
