/**
 * Signature Detail Page
 *
 * 签名详情页 - 显示签名统计和关联的策略
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { immuneApi } from '../../api/immune.api';
import type { SignatureDetail } from '../../types/immune';
import { PolicyCard } from './components/PolicyCard';

export default function SignatureDetailPage() {
  const { signature } = useParams<{ signature: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<SignatureDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signature) return;
    loadSignature();
  }, [signature]);

  const loadSignature = async () => {
    if (!signature) return;

    try {
      setLoading(true);
      setError(null);
      const result = await immuneApi.fetchSignature(decodeURIComponent(signature));
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signature');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-700 dark:text-red-400">{error || 'Signature not found'}</p>
          <button onClick={() => navigate('/immune/signatures')} className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Back to Signatures
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Failure Signature</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 font-mono mt-1">{data.signature}</p>
        </div>
        <button
          onClick={() => navigate('/immune/signatures')}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
        >
          Back
        </button>
      </div>

      {/* Statistics */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Statistics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Occurrences</div>
            <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{data.count}</div>
          </div>
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">First Seen</div>
            <div className="mt-1 text-sm text-gray-900 dark:text-gray-100">
              {new Date(data.first_seen).toLocaleString('zh-CN')}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Last Seen</div>
            <div className="mt-1 text-sm text-gray-900 dark:text-gray-100">
              {new Date(data.last_seen).toLocaleString('zh-CN')}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Policies</div>
            <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{data.policies.length}</div>
          </div>
        </div>
      </div>

      {/* Related Policies */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Related Policies ({data.policies.length})</h2>
        {data.policies.length === 0 ? (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <p className="text-amber-700 dark:text-amber-400">
              ⚠️ No policies found for this signature. Consider creating one.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.policies.map((policy) => (
              <PolicyCard key={policy.policy_id} policy={policy} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
