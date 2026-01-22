import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Check, X, Clock } from 'lucide-react';
import QRCode from 'qrcode.react';
import type { LoginSession } from '../../api/accounts.api';
import { accountsApi } from '../../api/accounts.api';

export default function PlatformLogin() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<LoginSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (id) {
      initiateLogin();
    }
  }, [id]);

  useEffect(() => {
    if (!session) return;

    // Poll login status every 2 seconds
    const interval = setInterval(async () => {
      try {
        const status = await accountsApi.getLoginStatus(session.sessionId);
        setSession(status);

        if (status.status === 'success') {
          clearInterval(interval);
          setTimeout(() => {
            navigate('/accounts');
          }, 2000);
        }

        if (status.status === 'failed' || status.status === 'expired') {
          clearInterval(interval);
        }
      } catch (error) {
        console.error('Failed to get login status:', error);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [session?.sessionId]);

  useEffect(() => {
    if (!session) return;

    const expiresAt = new Date(session.expiresAt).getTime();
    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
      setCountdown(remaining);

      if (remaining === 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.expiresAt]);

  const initiateLogin = async () => {
    if (!id) return;

    try {
      setLoading(true);
      const account = await accountsApi.getAccount(id);
      const loginSession = await accountsApi.initiateLogin(account.platform, account.accountId);
      setSession(loginSession);
    } catch (error) {
      console.error('Failed to initiate login:', error);
      alert('登录初始化失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!session) return;

    try {
      const newSession = await accountsApi.refreshQRCode(session.sessionId);
      setSession(newSession);
    } catch (error) {
      console.error('Failed to refresh QR code:', error);
      alert('刷新失败');
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">无法加载登录会话</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/accounts')}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">扫码登录</h1>
          <p className="text-gray-500 mt-1">{session.platform} - {session.accountId}</p>
        </div>
      </div>

      {/* QR Code Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-8">
        <div className="flex flex-col items-center">
          {/* Status Header */}
          <div className="mb-6 text-center">
            {session.status === 'pending' && (
              <div className="flex items-center gap-2 text-blue-600">
                <Clock className="w-5 h-5" />
                <span className="font-medium">等待扫码</span>
              </div>
            )}
            {session.status === 'scanned' && (
              <div className="flex items-center gap-2 text-orange-600">
                <Clock className="w-5 h-5" />
                <span className="font-medium">已扫码，请在手机上确认</span>
              </div>
            )}
            {session.status === 'success' && (
              <div className="flex items-center gap-2 text-green-600">
                <Check className="w-5 h-5" />
                <span className="font-medium">登录成功</span>
              </div>
            )}
            {session.status === 'failed' && (
              <div className="flex items-center gap-2 text-red-600">
                <X className="w-5 h-5" />
                <span className="font-medium">登录失败</span>
              </div>
            )}
            {session.status === 'expired' && (
              <div className="flex items-center gap-2 text-gray-600">
                <X className="w-5 h-5" />
                <span className="font-medium">二维码已过期</span>
              </div>
            )}
          </div>

          {/* QR Code */}
          {session.qrCode && (session.status === 'pending' || session.status === 'scanned') && (
            <div className="relative mb-6">
              <div className="p-4 bg-white border-2 border-gray-200 rounded-xl">
                <QRCode value={session.qrCode} size={256} />
              </div>
              {session.status === 'scanned' && (
                <div className="absolute inset-0 bg-white bg-opacity-90 flex items-center justify-center rounded-xl">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-3"></div>
                    <p className="text-sm font-medium text-gray-900">请在手机上确认</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Success Message */}
          {session.status === 'success' && (
            <div className="mb-6 text-center">
              <div className="w-20 h-20 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                <Check className="w-10 h-10 text-green-600" />
              </div>
              <p className="text-gray-600">正在跳转...</p>
            </div>
          )}

          {/* Countdown */}
          {countdown > 0 && session.status === 'pending' && (
            <div className="mb-4 text-sm text-gray-500">
              二维码将在 <span className="font-medium text-gray-900">{formatTime(countdown)}</span> 后过期
            </div>
          )}

          {/* Refresh Button */}
          {(session.status === 'expired' || (session.status === 'pending' && countdown === 0)) && (
            <button
              onClick={handleRefresh}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
              刷新二维码
            </button>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <h3 className="font-medium text-gray-900 mb-3">登录步骤</h3>
          <ol className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start">
              <span className="inline-flex items-center justify-center w-5 h-5 mr-2 text-xs font-medium text-white bg-blue-600 rounded-full flex-shrink-0">1</span>
              打开 {session.platform} App
            </li>
            <li className="flex items-start">
              <span className="inline-flex items-center justify-center w-5 h-5 mr-2 text-xs font-medium text-white bg-blue-600 rounded-full flex-shrink-0">2</span>
              找到扫码功能
            </li>
            <li className="flex items-start">
              <span className="inline-flex items-center justify-center w-5 h-5 mr-2 text-xs font-medium text-white bg-blue-600 rounded-full flex-shrink-0">3</span>
              扫描上方二维码
            </li>
            <li className="flex items-start">
              <span className="inline-flex items-center justify-center w-5 h-5 mr-2 text-xs font-medium text-white bg-blue-600 rounded-full flex-shrink-0">4</span>
              在手机上确认登录
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
