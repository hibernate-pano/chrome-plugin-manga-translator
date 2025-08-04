/**
 * 历史记录页面
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useTranslationStore } from '@/stores/translation';

export const History: React.FC = () => {
  const { history, clearHistory } = useTranslationStore();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredHistory = history.filter(item =>
    item.originalText.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.translatedText.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  const handleClearHistory = () => {
    if (confirm('确定要清除所有翻译历史吗？此操作不可撤销。')) {
      clearHistory();
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">翻译历史</h1>
        <p className="text-muted-foreground">
          查看和管理您的翻译历史记录
        </p>
      </div>

      <div className="mb-6 flex gap-4">
        <Input
          placeholder="搜索翻译历史..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1"
        />
        <Button
          variant="destructive"
          onClick={handleClearHistory}
          disabled={history.length === 0}
        >
          清除历史
        </Button>
      </div>

      {filteredHistory.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <p className="text-muted-foreground mb-2">
                {searchTerm ? '没有找到匹配的翻译记录' : '暂无翻译历史'}
              </p>
              {searchTerm && (
                <Button
                  variant="outline"
                  onClick={() => setSearchTerm('')}
                >
                  清除搜索
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredHistory.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    {item.sourceLanguage} → {item.targetLanguage}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{item.provider}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(item.timestamp)}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">原文</h4>
                    <p className="text-sm bg-muted p-3 rounded">
                      {item.originalText}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">译文</h4>
                    <p className="text-sm bg-muted p-3 rounded">
                      {item.translatedText}
                    </p>
                  </div>
                  {item.confidence && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        置信度:
                      </span>
                      <Badge variant={item.confidence > 0.8 ? 'default' : 'secondary'}>
                        {(item.confidence * 100).toFixed(1)}%
                      </Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default History;
