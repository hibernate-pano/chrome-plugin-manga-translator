import React from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';

interface ModeSelectorProps {
  mode: 'manual' | 'auto';
  onChange: (mode: 'manual' | 'auto') => void;
}

const ModeSelector: React.FC<ModeSelectorProps> = ({ mode, onChange }) => {
  return (
    <div className="space-y-3">
      <Label>翻译模式</Label>
      <RadioGroup value={mode} onValueChange={onChange} className="grid grid-cols-2 gap-4">
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="manual" id="manual" />
          <Label htmlFor="manual" className="text-sm font-normal">
            手动翻译
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="auto" id="auto" />
          <Label htmlFor="auto" className="text-sm font-normal">
            自动翻译
          </Label>
        </div>
      </RadioGroup>
      <p className="text-xs text-muted-foreground">
        {mode === 'manual' 
          ? '手动模式：点击漫画图像进行翻译' 
          : '自动模式：自动检测并翻译页面上的漫画'}
      </p>
    </div>
  );
};

export default ModeSelector;
