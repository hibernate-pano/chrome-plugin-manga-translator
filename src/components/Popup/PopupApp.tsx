import React, { useEffect, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAppConfigStore } from '@/stores/config-v2';
import type {
  ContentRequest,
  ContentResponse,
  ContentRuntimeState,
  ContentStateUpdateMessage,
} from '@/shared/runtime-contracts';
import { matchSiteAdapter } from '@/content/site-adapters';

const EMPTY_STATE: ContentRuntimeState = {
  status: 'unsupported',
  support: {
    supported: false,
    site: null,
    reason: '当前标签页不受支持',
  },
  message: '当前标签页不受支持',
  selectedImageUrl: null,
  translatedCount: 0,
};

function isSupportedTabUrl(url?: string): boolean {
  if (!url || !/^https?:\/\//.test(url)) {
    return false;
  }

  try {
    return Boolean(matchSiteAdapter(url));
  } catch {
    return false;
  }
}

async function sendToTab(
  tabId: number,
  request: ContentRequest
): Promise<ContentResponse> {
  return (await chrome.tabs.sendMessage(tabId, request)) as ContentResponse;
}

function getPrimaryAction(
  state: ContentRuntimeState
): {
  label: string;
  request: ContentRequest | null;
  disabled: boolean;
} {
  switch (state.status) {
    case 'picking':
      return {
        label: '取消选图',
        request: { type: 'CANCEL_PICKING' },
        disabled: false,
      };
    case 'translating':
      return {
        label: '翻译中',
        request: null,
        disabled: true,
      };
    default:
      return {
        label: '开始选图翻译',
        request: { type: 'START_PICKING' },
        disabled: false,
      };
  }
}

const PopupApp: React.FC = () => {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [contentState, setContentState] =
    useState<ContentRuntimeState>(EMPTY_STATE);
  const [activeTabUrl, setActiveTabUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const server = useAppConfigStore(state => state.server);
  const isServerConfigured = useAppConfigStore(state => state.isServerConfigured);

  useEffect(() => {
    const handleRuntimeMessage = (message: unknown) => {
      const payload = message as ContentStateUpdateMessage;
      if (payload?.type === 'CONTENT_STATE_UPDATE') {
        setContentState(payload.state);
      }
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, []);

  const refreshContentState = async (): Promise<void> => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      const tabId = tab?.id ?? null;
      const url = tab?.url ?? '';

      setActiveTabId(tabId);
      setActiveTabUrl(url);

      if (!tabId || !isSupportedTabUrl(url)) {
        setContentState({
          ...EMPTY_STATE,
          message: '仅支持 ManhwaRead 章节阅读页',
          support: {
            supported: false,
            site: null,
            reason: '仅支持 ManhwaRead 章节阅读页',
          },
        });
        return;
      }

      const response = await sendToTab(tabId, {
        type: 'GET_CONTENT_STATE',
      });

      if (response.state) {
        setContentState(response.state);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : '无法连接到页面内容脚本'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshContentState();
  }, []);

  const primaryAction = getPrimaryAction(contentState);

  const runAction = async (request: ContentRequest): Promise<void> => {
    if (!activeTabId) {
      return;
    }

    try {
      setErrorMessage(null);
      const response = await sendToTab(activeTabId, request);

      if (response.state) {
        setContentState(response.state);
      }

      if (!response.success && response.error) {
        setErrorMessage(response.error);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : '页面通信失败'
      );
    }
  };

  return (
    <div className='min-w-[360px] bg-background p-4 text-foreground'>
      <Card>
        <CardHeader>
          <CardTitle>ManhwaRead Translator</CardTitle>
          <CardDescription>
            仅保证 ManhwaRead 章节页的单图手动翻译。
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='rounded-lg border border-border/70 bg-muted/40 p-3 text-sm'>
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground'>当前站点</span>
              <span className='font-medium'>
                {isSupportedTabUrl(activeTabUrl) ? 'ManhwaRead' : '不支持'}
              </span>
            </div>
            <div className='mt-2 flex items-center justify-between'>
              <span className='text-muted-foreground'>服务端</span>
              <span className='font-medium'>
                {isServerConfigured() ? server.baseUrl : '未配置'}
              </span>
            </div>
            <div className='mt-2 flex items-center justify-between'>
              <span className='text-muted-foreground'>当前状态</span>
              <span className='font-medium'>{contentState.status}</span>
            </div>
          </div>

          {!isServerConfigured() && (
            <Alert variant='destructive'>
              <AlertCircle className='h-4 w-4' />
              <AlertTitle>服务端未配置</AlertTitle>
              <AlertDescription>
                请先在设置页填写本地服务端地址和鉴权信息。
              </AlertDescription>
            </Alert>
          )}

          {(errorMessage || contentState.message) && (
            <Alert
              variant={
                contentState.status === 'error' || errorMessage
                  ? 'destructive'
                  : 'default'
              }
            >
              <AlertCircle className='h-4 w-4' />
              <AlertTitle>页面反馈</AlertTitle>
              <AlertDescription>
                {errorMessage || contentState.message}
              </AlertDescription>
            </Alert>
          )}

          <div className='flex gap-2'>
            <Button
              className='flex-1'
              disabled={
                loading ||
                !contentState.support.supported ||
                !isServerConfigured() ||
                primaryAction.disabled
              }
              onClick={() => {
                if (primaryAction.request) {
                  void runAction(primaryAction.request);
                }
              }}
            >
              {loading ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : null}
              {primaryAction.label}
            </Button>
            <Button
              variant='outline'
              onClick={() => void runAction({ type: 'CLEAR_OVERLAYS' })}
            >
              清除覆盖层
            </Button>
          </div>

          <div className='flex gap-2'>
            <Button
              className='flex-1'
              variant='outline'
              onClick={() => chrome.runtime.openOptionsPage()}
            >
              <ExternalLink className='mr-2 h-4 w-4' />
              打开设置
            </Button>
            <Button
              variant='ghost'
              onClick={() => void refreshContentState()}
            >
              <RefreshCw className='mr-2 h-4 w-4' />
              刷新
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PopupApp;
