import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfigStore } from '@/stores/config';
import { Info } from 'lucide-react';

const StyleSettings = () => {
  const {
    styleLevel,
    setStyleLevel,
    textColor,
    setTextColor,
    backgroundColor,
    setBackgroundColor,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    showOriginalText,
    setShowOriginalText,
    textAlignment,
    setTextAlignment,
    lineSpacing,
    setLineSpacing
  } = useConfigStore();

  // 字体选项
  const fontOptions = [
    { value: 'sans-serif', label: '无衬线字体' },
    { value: 'serif', label: '衬线字体' },
    { value: 'monospace', label: '等宽字体' },
    { value: '"Noto Sans CJK JP", "Microsoft YaHei", sans-serif', label: '中日韩字体' }
  ];

  // 文本对齐选项
  const alignmentOptions = [
    { value: 'left', label: '左对齐' },
    { value: 'center', label: '居中' },
    { value: 'right', label: '右对齐' },
    { value: 'justify', label: '两端对齐' }
  ];

  // 字体大小选项
  const fontSizeOptions = [
    { value: 'smaller', label: '更小' },
    { value: 'small', label: '小' },
    { value: 'medium', label: '中等' },
    { value: 'large', label: '大' },
    { value: 'larger', label: '更大' }
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>样式保持程度</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="style-level">平衡清晰度和美观度</Label>
                <div title="调整翻译文本的样式保持程度，值越高越接近原图样式" className="inline-block">
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </div>
              </div>
              <Slider
                id="style-level"
                min={0}
                max={100}
                step={1}
                value={[styleLevel]}
                onValueChange={(values) => setStyleLevel(values[0] || 50)}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>更清晰</span>
                <span>更美观</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>文本样式</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="text-color">文本颜色</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="text-color"
                  type="color"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="w-12 h-10 p-0 border-0"
                />
                <Input
                  type="text"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  placeholder="#000000"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="background-color">背景颜色</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="background-color"
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="w-12 h-10 p-0 border-0"
                />
                <Input
                  type="text"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  placeholder="rgba(255, 255, 255, 0.8)"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="font-family">字体</Label>
              <Select value={fontFamily} onValueChange={setFontFamily}>
                <SelectTrigger id="font-family">
                  <SelectValue placeholder="选择字体" />
                </SelectTrigger>
                <SelectContent>
                  {fontOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="font-size">字体大小</Label>
              <Select value={fontSize} onValueChange={setFontSize}>
                <SelectTrigger id="font-size">
                  <SelectValue placeholder="选择字体大小" />
                </SelectTrigger>
                <SelectContent>
                  {fontSizeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="text-alignment">文本对齐</Label>
              <Select value={textAlignment} onValueChange={setTextAlignment}>
                <SelectTrigger id="text-alignment">
                  <SelectValue placeholder="选择文本对齐方式" />
                </SelectTrigger>
                <SelectContent>
                  {alignmentOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="line-spacing">行间距</Label>
                <span className="text-sm text-muted-foreground">{lineSpacing}%</span>
              </div>
              <Slider
                id="line-spacing"
                min={50}
                max={200}
                step={5}
                value={[lineSpacing]}
                onValueChange={(values) => setLineSpacing(values[0] || 100)}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>紧凑</span>
                <span>宽松</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>高级选项</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="show-original-text">显示原文</Label>
                <div title="在翻译文本下方显示原文" className="inline-block">
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </div>
              </div>
              <Switch
                id="show-original-text"
                checked={showOriginalText}
                onCheckedChange={setShowOriginalText}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-css">自定义CSS（高级）</Label>
              <Input
                id="custom-css"
                type="text"
                placeholder="输入自定义CSS选择器和样式"
                className="w-full"
                // 这里可以添加自定义CSS支持
              />
              <p className="text-xs text-muted-foreground">
                示例：.manga-translator-text {`{ font-weight: bold; }`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>样式预览</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-6 border rounded-lg bg-muted/50">
            <div 
              className="manga-translator-preview"
              style={{
                fontSize: fontSize === 'smaller' ? '12px' : 
                          fontSize === 'small' ? '14px' : 
                          fontSize === 'medium' ? '16px' : 
                          fontSize === 'large' ? '18px' : '20px',
                fontFamily,
                color: textColor,
                backgroundColor,
                textAlign: textAlignment,
                lineHeight: `${lineSpacing / 100}`,
                padding: '10px',
                borderRadius: '4px',
                margin: '10px 0'
              }}
            >
              <p>这是一个样式预览示例</p>
              <p>这里展示了文本颜色、背景颜色、字体大小、字体和行间距的效果</p>
              {showOriginalText && (
                <div className="mt-4 p-2 bg-muted text-sm">
                  <p>这是原文的显示效果示例</p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StyleSettings;