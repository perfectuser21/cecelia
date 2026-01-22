import React, { useState, useEffect } from 'react';
import { Save, TestTube, Check, X } from 'lucide-react';
import type { SystemSettings } from '../api/settings.api';
import { settingsApi } from '../api/settings.api';

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingFeishu, setTestingFeishu] = useState(false);
  const [testingNotion, setTestingNotion] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getSettings();
      setSettings(data);
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;

    try {
      setSaving(true);
      await settingsApi.updateSettings(settings);
      alert('设置已保存');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTestFeishu = async () => {
    if (!settings?.notifications.feishu.webhookUrl) {
      alert('请先输入飞书 Webhook URL');
      return;
    }

    try {
      setTestingFeishu(true);
      const result = await settingsApi.testFeishuWebhook(settings.notifications.feishu.webhookUrl);
      if (result.success) {
        alert('测试成功！请检查飞书群组');
      } else {
        alert(`测试失败: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to test Feishu:', error);
      alert('测试失败');
    } finally {
      setTestingFeishu(false);
    }
  };

  const handleTestNotion = async () => {
    if (!settings?.notion.apiKey || !settings?.notion.databaseId) {
      alert('请先输入 Notion API Key 和 Database ID');
      return;
    }

    try {
      setTestingNotion(true);
      const result = await settingsApi.testNotionConnection(
        settings.notion.apiKey,
        settings.notion.databaseId
      );
      if (result.success) {
        alert('连接成功！');
      } else {
        alert(`连接失败: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to test Notion:', error);
      alert('测试失败');
    } finally {
      setTestingNotion(false);
    }
  };

  const handleChange = (path: string, value: any) => {
    if (!settings) return;

    const keys = path.split('.');
    const newSettings = { ...settings };
    let current: any = newSettings;

    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = value;
    setSettings(newSettings);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">无法加载设置</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">系统设置</h1>
          <p className="text-gray-500 mt-1">配置系统参数和集成</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>

      {/* Feishu Notification */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">飞书通知</h2>
        <div className="space-y-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="feishuEnabled"
              checked={settings.notifications.feishu.enabled}
              onChange={(e) => handleChange('notifications.feishu.enabled', e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="feishuEnabled" className="ml-2 text-sm font-medium text-gray-700">
              启用飞书通知
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Webhook URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.notifications.feishu.webhookUrl}
                onChange={(e) => handleChange('notifications.feishu.webhookUrl', e.target.value)}
                placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleTestFeishu}
                disabled={testingFeishu}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <TestTube className="w-4 h-4" />
                {testingFeishu ? '测试中...' : '测试'}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">通知类型</p>
            <div className="space-y-2">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="notifySuccess"
                  checked={settings.notifications.feishu.notifyOnSuccess}
                  onChange={(e) => handleChange('notifications.feishu.notifyOnSuccess', e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="notifySuccess" className="ml-2 text-sm text-gray-700">
                  成功通知
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="notifyFailure"
                  checked={settings.notifications.feishu.notifyOnFailure}
                  onChange={(e) => handleChange('notifications.feishu.notifyOnFailure', e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="notifyFailure" className="ml-2 text-sm text-gray-700">
                  失败通知
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="notifyLogin"
                  checked={settings.notifications.feishu.notifyOnLogin}
                  onChange={(e) => handleChange('notifications.feishu.notifyOnLogin', e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="notifyLogin" className="ml-2 text-sm text-gray-700">
                  登录过期通知
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="notifyMetrics"
                  checked={settings.notifications.feishu.notifyOnMetrics}
                  onChange={(e) => handleChange('notifications.feishu.notifyOnMetrics', e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="notifyMetrics" className="ml-2 text-sm text-gray-700">
                  数据报告通知
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notion Integration */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Notion 集成</h2>
        <div className="space-y-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="notionEnabled"
              checked={settings.notion.enabled}
              onChange={(e) => handleChange('notion.enabled', e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="notionEnabled" className="ml-2 text-sm font-medium text-gray-700">
              启用 Notion 集成
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              API Key
            </label>
            <input
              type="password"
              value={settings.notion.apiKey}
              onChange={(e) => handleChange('notion.apiKey', e.target.value)}
              placeholder="secret_..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Database ID
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.notion.databaseId}
                onChange={(e) => handleChange('notion.databaseId', e.target.value)}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleTestNotion}
                disabled={testingNotion}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <TestTube className="w-4 h-4" />
                {testingNotion ? '测试中...' : '测试'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Collection Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">数据采集配置</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              超时时间（秒）
            </label>
            <input
              type="number"
              value={settings.collection.timeout}
              onChange={(e) => handleChange('collection.timeout', parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              重试次数
            </label>
            <input
              type="number"
              value={settings.collection.retries}
              onChange={(e) => handleChange('collection.retries', parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              并发数
            </label>
            <input
              type="number"
              value={settings.collection.concurrency}
              onChange={(e) => handleChange('collection.concurrency', parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Alert Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">告警设置</h2>
        <div className="space-y-4">
          <div>
            <div className="flex items-center mb-2">
              <input
                type="checkbox"
                id="loginExpiryEnabled"
                checked={settings.alerts.loginExpiry.enabled}
                onChange={(e) => handleChange('alerts.loginExpiry.enabled', e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="loginExpiryEnabled" className="ml-2 text-sm font-medium text-gray-700">
                登录过期告警
              </label>
            </div>
            <input
              type="number"
              value={settings.alerts.loginExpiry.daysBeforeExpiry}
              onChange={(e) => handleChange('alerts.loginExpiry.daysBeforeExpiry', parseInt(e.target.value))}
              placeholder="提前天数"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={!settings.alerts.loginExpiry.enabled}
            />
          </div>

          <div>
            <div className="flex items-center mb-2">
              <input
                type="checkbox"
                id="followerDropEnabled"
                checked={settings.alerts.followerDrop.enabled}
                onChange={(e) => handleChange('alerts.followerDrop.enabled', e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="followerDropEnabled" className="ml-2 text-sm font-medium text-gray-700">
                粉丝下降告警
              </label>
            </div>
            <input
              type="number"
              value={settings.alerts.followerDrop.threshold}
              onChange={(e) => handleChange('alerts.followerDrop.threshold', parseInt(e.target.value))}
              placeholder="下降百分比阈值"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={!settings.alerts.followerDrop.enabled}
            />
          </div>

          <div>
            <div className="flex items-center mb-2">
              <input
                type="checkbox"
                id="engagementDropEnabled"
                checked={settings.alerts.engagementDrop.enabled}
                onChange={(e) => handleChange('alerts.engagementDrop.enabled', e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="engagementDropEnabled" className="ml-2 text-sm font-medium text-gray-700">
                互动下降告警
              </label>
            </div>
            <input
              type="number"
              value={settings.alerts.engagementDrop.threshold}
              onChange={(e) => handleChange('alerts.engagementDrop.threshold', parseInt(e.target.value))}
              placeholder="下降阈值"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={!settings.alerts.engagementDrop.enabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
