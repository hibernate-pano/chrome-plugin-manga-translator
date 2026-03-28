import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Server } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppConfigStore } from '@/stores/config-v2';
import type { TestServerConnectionResponse } from '@/shared/runtime-contracts';
import type { TranslationStylePreset } from '@/utils/translation-style';

const TARGET_LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁体中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
];

const STYLE_PRESETS: Array<{
  value: TranslationStylePreset;
  label: string;
  description: string;
}> = [
  {
    value: 'natural-zh',
    label: '自然中文',
    description: '优先阅读流畅度，适合沉浸式阅读。',
  },
  {
    value: 'faithful',
    label: '忠实原文',
    description: '尽量保留原句语气和信息密度。',
  },
  {
    value: 'concise-bubble',
    label: '气泡精简',
    description: '优先短句和紧凑排版。',
  },
];

const OptionsApp: React.FC = () => {
  const server = useAppConfigStore(state => state.server);
  const targetLanguage = useAppConfigStore(state => state.targetLanguage);
  const translationStylePreset = useAppConfigStore(
    state => state.translationStylePreset
  );
  const updateServerConfig = useAppConfigStore(
    state => state.updateServerConfig
  );
  const setTargetLanguage = useAppConfigStore(
    state => state.setTargetLanguage
  );
  const setTranslationStylePreset = useAppConfigStore(
    state => state.setTranslationStylePreset
  );
  const isServerConfigured = useAppConfigStore(state => state.isServerConfigured);

  const [testing, setTesting] = useState(false);
  const [serverResult, setServerResult] =
    useState<TestServerConnectionResponse | null>(null);

  const handleTestServer = async (): Promise<void> => {
    setTesting(true);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'TEST_SERVER_CONNECTION',
      })) as TestServerConnectionResponse;
      setServerResult(response);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className='mx-auto max-w-4xl space-y-6 bg-background px-6 py-8 text-foreground'>
      <Card>
        <CardHeader>
          <CardTitle>ManhwaRead-First 设置</CardTitle>
          <CardDescription>
            这一版只保证 ManhwaRead 章节页的单图手动翻译。扩展本身不再直连
            provider，所有翻译都经由你配置的服务端。
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Server className='h-4 w-4' />
            服务端配置
          </CardTitle>
          <CardDescription>
            推荐本地运行 `http://127.0.0.1:8000`。
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='server-base-url'>服务端地址</Label>
            <Input
              id='server-base-url'
              value={server.baseUrl}
              onChange={event =>
                updateServerConfig({ baseUrl: event.target.value })
              }
              placeholder='http://127.0.0.1:8000'
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='server-auth-token'>鉴权 Token</Label>
            <Input
              id='server-auth-token'
              value={server.authToken}
              onChange={event =>
                updateServerConfig({ authToken: event.target.value })
              }
              placeholder='可选'
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='server-timeout'>超时时间（毫秒）</Label>
            <Input
              id='server-timeout'
              type='number'
              min={1000}
              value={String(server.timeoutMs)}
              onChange={event =>
                updateServerConfig({
                  timeoutMs: Number(event.target.value) || 30000,
                })
              }
            />
          </div>

          <div className='flex items-center gap-3'>
            <Button disabled={testing || !server.baseUrl} onClick={() => void handleTestServer()}>
              {testing ? '测试中...' : '测试连接'}
            </Button>
            <span className='text-sm text-muted-foreground'>
              {isServerConfigured() ? '已配置服务端地址' : '尚未完成服务端配置'}
            </span>
          </div>

          {serverResult && (
            <Alert variant={serverResult.success ? 'default' : 'destructive'}>
              {serverResult.success ? (
                <CheckCircle2 className='h-4 w-4' />
              ) : (
                <AlertCircle className='h-4 w-4' />
              )}
              <AlertTitle>
                {serverResult.success ? '连接成功' : '连接失败'}
              </AlertTitle>
              <AlertDescription>{serverResult.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>翻译偏好</CardTitle>
          <CardDescription>
            这些偏好会在每次手动选图时直接带给服务端。
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='target-language'>目标语言</Label>
            <select
              id='target-language'
              className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              value={targetLanguage}
              onChange={event => setTargetLanguage(event.target.value)}
            >
              {TARGET_LANGUAGES.map(language => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='translation-style'>翻译风格</Label>
            <select
              id='translation-style'
              className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              value={translationStylePreset}
              onChange={event =>
                setTranslationStylePreset(
                  event.target.value as TranslationStylePreset
                )
              }
            >
              {STYLE_PRESETS.map(preset => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
            <p className='text-sm text-muted-foreground'>
              {
                STYLE_PRESETS.find(
                  preset => preset.value === translationStylePreset
                )?.description
              }
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>当前支持范围</CardTitle>
          <CardDescription>
            先把边界收紧，先把一个站点做到稳定。
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-2 text-sm text-muted-foreground'>
          <p>正式保证：`https://manhwaread.com/manhwa/*/chapter-*`</p>
          <p>正式入口：Popup 中点击“开始选图翻译”，然后点章节图片。</p>
          <p>不保证：整页自动翻译、阅读层、provider 直连、多站点兼容。</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default OptionsApp;
