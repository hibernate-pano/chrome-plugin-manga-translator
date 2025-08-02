import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

interface Language {
  code: string;
  name: string;
}

const languages: Language[] = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: '英语' },
  { code: 'ja', name: '日语' },
  { code: 'ko', name: '韩语' },
  { code: 'fr', name: '法语' },
  { code: 'de', name: '德语' },
  { code: 'es', name: '西班牙语' },
  { code: 'ru', name: '俄语' },
];

interface LanguageSelectorProps {
  language: string;
  onChange: (language: string) => void;
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ language, onChange }) => {
  const selectedLanguage = languages.find(lang => lang.code === language);

  return (
    <div className="space-y-2">
      <Label htmlFor="language-select">目标语言</Label>
      <Select value={language} onValueChange={onChange}>
        <SelectTrigger id="language-select">
          <SelectValue placeholder="选择目标语言">
            {selectedLanguage?.name}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {languages.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {lang.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default LanguageSelector;
