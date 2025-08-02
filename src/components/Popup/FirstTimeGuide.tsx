import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, ExternalLink } from 'lucide-react';

interface FirstTimeGuideProps {
  onContinue: () => void;
}

const FirstTimeGuide: React.FC<FirstTimeGuideProps> = ({ onContinue }) => {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary">
          <AlertCircle className="w-5 h-5" />
          欢迎使用漫画翻译助手!
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          使用前需要设置API密钥以激活翻译功能。
        </p>
        
        <div className="space-y-2">
          <p className="text-sm font-medium">支持的服务商：</p>
          <ul className="text-sm text-muted-foreground space-y-1 ml-4">
            <li className="flex items-center gap-2">
              <div className="w-1 h-1 bg-current rounded-full" />
              OpenAI (GPT)
            </li>
            <li className="flex items-center gap-2">
              <div className="w-1 h-1 bg-current rounded-full" />
              Anthropic (Claude)
            </li>
            <li className="flex items-center gap-2">
              <div className="w-1 h-1 bg-current rounded-full" />
              DeepSeek
            </li>
            <li className="flex items-center gap-2">
              <div className="w-1 h-1 bg-current rounded-full" />
              SiliconFlow (Qwen)
            </li>
          </ul>
        </div>
        
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium mb-1">安全提示</p>
                <p>
                  API密钥将安全存储在本地，不会上传到任何服务器。
                  请妥善保管您的密钥，避免泄露。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Button 
          onClick={onContinue} 
          className="w-full"
          size="lg"
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          前往设置API密钥
        </Button>
      </CardContent>
    </Card>
  );
};

export default FirstTimeGuide;
