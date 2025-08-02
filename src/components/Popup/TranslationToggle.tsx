import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface TranslationToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

const TranslationToggle: React.FC<TranslationToggleProps> = ({ enabled, onChange }) => {
  return (
    <div className="flex items-center justify-between space-x-2">
      <Label htmlFor="translation-toggle" className="text-sm font-medium">
        启用翻译
      </Label>
      <Switch
        id="translation-toggle"
        checked={enabled}
        onCheckedChange={onChange}
      />
    </div>
  );
};

export default TranslationToggle;
