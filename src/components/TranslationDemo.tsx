import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Send, Copy, Check } from 'lucide-react';
import { useTranslateText, useTranslateMutation, useBatchTranslateMutation } from '@/hooks/useTranslation';
import { AnimatedContainer, FloatingElement } from '@/components/ui/animated-container';

/**
 * 翻译演示组件
 * 展示React Query集成的翻译功能
 */
export function TranslationDemo() {
  const [inputText, setInputText] = useState('');
  const [targetLang, setTargetLang] = useState('zh');
  const [batchTexts, setBatchTexts] = useState('');
  const [copied, setCopied] = useState(false);

  // 使用查询钩子进行实时翻译（当输入文本变化时自动翻译）
  const {
    data: translationResult,
    isLoading: isTranslating,
    error: translationError,
    refetch: retryTranslation,
  } = useTranslateText(
    {
      text: inputText,
      targetLang,
    },
    inputText.length > 0 // 只有当有输入文本时才启用查询
  );

  // 使用变更钩子进行手动翻译
  const translateMutation = useTranslateMutation();
  const batchTranslateMutation = useBatchTranslateMutation();

  // 处理单文本翻译
  const handleTranslate = () => {
    if (inputText.trim()) {
      translateMutation.mutate({
        text: inputText,
        targetLang,
      });
    }
  };

  // 处理批量翻译
  const handleBatchTranslate = () => {
    const texts = batchTexts
      .split('\n')
      .map(text => text.trim())
      .filter(text => text.length > 0);

    if (texts.length > 0) {
      batchTranslateMutation.mutate({
        texts,
        targetLang,
      });
    }
  };

  // 复制翻译结果
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  };

  const languages = [
    { value: 'zh', label: '中文' },
    { value: 'en', label: 'English' },
    { value: 'ja', label: '日本語' },
    { value: 'ko', label: '한국어' },
    { value: 'fr', label: 'Français' },
    { value: 'de', label: 'Deutsch' },
    { value: 'es', label: 'Español' },
  ];

  return (
    <div className="space-y-6">
      {/* 实时翻译演示 */}
      <AnimatedContainer direction="up">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              实时翻译演示
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="input-text">输入文本</Label>
                <Textarea
                  id="input-text"
                  placeholder="输入要翻译的文本..."
                  value={inputText}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInputText(e.target.value)}
                  className="min-h-[100px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="target-lang">目标语言</Label>
                <Select value={targetLang} onValueChange={setTargetLang}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择目标语言" />
                  </SelectTrigger>
                  <SelectContent>
                    {languages.map((lang) => (
                      <SelectItem key={lang.value} value={lang.value}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 翻译结果 */}
            {(isTranslating || translationResult || translationError) && (
              <FloatingElement>
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    {isTranslating && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        正在翻译...
                      </div>
                    )}

                    {translationResult && !isTranslating && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">翻译结果</Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(translationResult.translatedText)}
                          >
                            {copied ? (
                              <Check className="w-4 h-4" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                        <div className="p-3 bg-background rounded-md border">
                          {translationResult.translatedText}
                        </div>
                      </div>
                    )}

                    {translationError && (
                      <div className="space-y-2">
                        <div className="text-destructive text-sm">
                          翻译失败: {translationError.message}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => retryTranslation()}
                        >
                          重试
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </FloatingElement>
            )}
          </CardContent>
        </Card>
      </AnimatedContainer>

      {/* 手动翻译演示 */}
      <AnimatedContainer direction="up" delay={0.1}>
        <Card>
          <CardHeader>
            <CardTitle>手动翻译演示</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="输入要翻译的文本..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleTranslate()}
              />
              <Button
                onClick={handleTranslate}
                disabled={!inputText.trim() || translateMutation.isPending}
              >
                {translateMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>

            {translateMutation.data && (
              <FloatingElement>
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-sm font-medium">翻译结果</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopy(translateMutation.data.translatedText)}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="p-3 bg-background rounded-md border">
                      {translateMutation.data.translatedText}
                    </div>
                  </CardContent>
                </Card>
              </FloatingElement>
            )}
          </CardContent>
        </Card>
      </AnimatedContainer>

      {/* 批量翻译演示 */}
      <AnimatedContainer direction="up" delay={0.2}>
        <Card>
          <CardHeader>
            <CardTitle>批量翻译演示</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="batch-texts">批量文本（每行一个）</Label>
              <Textarea
                id="batch-texts"
                placeholder="输入多行文本，每行一个要翻译的内容..."
                value={batchTexts}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBatchTexts(e.target.value)}
                className="min-h-[120px]"
              />
            </div>

            <Button
              onClick={handleBatchTranslate}
              disabled={!batchTexts.trim() || batchTranslateMutation.isPending}
              className="w-full"
            >
              {batchTranslateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  批量翻译中...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  批量翻译
                </>
              )}
            </Button>

            {batchTranslateMutation.data && (
              <FloatingElement>
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <Label className="text-sm font-medium mb-2 block">批量翻译结果</Label>
                    <div className="space-y-2">
                      {batchTranslateMutation.data.map((result, index) => (
                        <div
                          key={index}
                          className="p-3 bg-background rounded-md border flex items-center justify-between"
                        >
                          <span>{result}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(result)}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </FloatingElement>
            )}
          </CardContent>
        </Card>
      </AnimatedContainer>
    </div>
  );
}
