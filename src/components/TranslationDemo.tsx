import React, { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useConfigStore } from '@/stores/config';
import { useTranslationStore } from '@/stores/translation';
import { Info, Upload, Save, RefreshCw } from 'lucide-react';
import { APIManager } from '../api/api-manager';
import { imageToBase64 } from '../utils/imageProcess';

const TranslationPreview = () => {
  // 状态管理
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const [textAreas, setTextAreas] = useState<any[]>([]);
  const [translatedTexts, setTranslatedTexts] = useState<string[]>([]);
  
  // 引用
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Zustand stores
  const {
    styleLevel,
    setStyleLevel,
    fontColor,
    setFontColor,
    backgroundColor,
    setBackgroundColor,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    advancedSettings: { showOriginalText },
    updateAdvancedSettings
  } = useConfigStore();
  
  const {
    targetLanguage,
    setTargetLanguage
  } = useTranslationStore();
  
  // API管理器
  const apiManager = APIManager.getInstance();
  
  // 语言选项
  const languageOptions = [
    { value: 'zh-CN', label: '简体中文' },
    { value: 'zh-TW', label: '繁體中文' },
    { value: 'en', label: '英语' },
    { value: 'ja', label: '日语' },
    { value: 'ko', label: '韩语' },
    { value: 'fr', label: '法语' },
    { value: 'de', label: '德语' },
    { value: 'es', label: '西班牙语' },
    { value: 'ru', label: '俄语' }
  ];
  
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
  
  // 组件内状态，用于演示
  const [textColor, setTextColor] = useState('#000000');
  const [textAlignment, setTextAlignment] = useState<'left' | 'center' | 'right'>('center');
  const [lineSpacing, setLineSpacing] = useState(100);
  
  // 处理图像上传
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setUploadedImage(result);
        setPreviewImage(result);
      };
      reader.readAsDataURL(file);
    }
  };
  
  // 触发文件选择
  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };
  
  // 处理翻译
  const handleTranslate = async () => {
    if (!uploadedImage) return;
    
    try {
      setIsProcessing(true);
      setProcessingStep('检测文字区域...');
      
      // 将图像转换为Base64
      const img = new Image();
      img.src = uploadedImage;
      await new Promise((resolve) => (img.onload = resolve));
      const base64Image = await imageToBase64(img);
      
      // 检测文字区域
      const detectedTextAreas = await apiManager.detectText(base64Image, {
        language: 'jpn',
        preprocess: true
      });
      setTextAreas(detectedTextAreas);
      setProcessingStep('翻译文本...');
      
      // 翻译文本
      const texts = detectedTextAreas.map((area: any) => area.text);
      const translations = await apiManager.translateText(
        texts,
        targetLanguage
      );
      setTranslatedTexts(Array.isArray(translations) ? translations : [translations]);
      setProcessingStep('渲染翻译结果...');
      
      // 这里可以添加实时渲染逻辑，使用renderTranslatedImage函数
      // 为了简化，我们暂时只显示翻译后的文本
      
      setProcessingStep('完成');
      setTimeout(() => {
        setIsProcessing(false);
        setProcessingStep('');
      }, 500);
      
    } catch (error) {
      console.error('翻译失败:', error);
      setIsProcessing(false);
      setProcessingStep('');
      alert(`翻译失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 保存设置
  const handleSaveSettings = () => {
    // 保存设置到配置存储
    alert('设置已保存');
  };
  
  // 重置设置
  const handleResetSettings = () => {
    // 重置设置到默认值
    setStyleLevel(50);
    setTextColor('#000000');
    setBackgroundColor('rgba(255, 255, 255, 0.8)');
    setFontSize('medium');
    setFontFamily('"Noto Sans CJK JP", "Microsoft YaHei", sans-serif');
    updateAdvancedSettings({ showOriginalText: false });
    setTextAlignment('center');
    setLineSpacing(100);
    setTargetLanguage('zh-CN');
    alert('设置已重置');
  };
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>翻译结果实时预览</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 左侧：图像上传和预览 */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>图像上传</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-center">
                      <div 
                        className="border-2 border-dashed border-muted rounded-lg p-4 text-center cursor-pointer hover:border-primary transition-colors"
                        onClick={triggerFileInput}
                      >
                        {uploadedImage ? (
                          <div className="relative">
                            <img 
                              src={uploadedImage} 
                              alt="上传的漫画" 
                              className="max-w-full max-h-64 object-contain"
                              onClick={() => setShowOriginal(!showOriginal)}
                            />
                            <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                              点击切换原图/翻译
                            </div>
                          </div>
                        ) : (
                          <div className="py-12">
                            <Upload className="w-12 h-12 mx-auto text-muted mb-2" />
                            <p className="text-muted-foreground">点击上传漫画图像</p>
                            <p className="text-xs text-muted-foreground mt-1">支持 JPG, PNG, WebP 格式</p>
                          </div>
                        )}
                        <input
                          type="file"
                          ref={fileInputRef}
                          accept="image/*"
                          className="hidden"
                          onChange={handleImageUpload}
                        />
                      </div>
                    </div>
                    
                    <div className="flex justify-center gap-2">
                      <Button
                        onClick={triggerFileInput}
                        variant="outline"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        选择图像
                      </Button>
                      
                      <Button
                        onClick={handleTranslate}
                        disabled={!uploadedImage || isProcessing}
                      >
                        {isProcessing ? (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                            {processingStep}
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            开始翻译
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* 预览区域 */}
              {previewImage && (
                <Card>
                  <CardHeader>
                    <CardTitle>翻译预览</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="relative">
                      <img 
                        src={previewImage} 
                        alt="翻译预览" 
                        className="max-w-full object-contain"
                      />
                      {textAreas.length > 0 && (
                        <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
                          {textAreas.map((area, index) => {
                            const translatedText = translatedTexts[index] || '';
                            return (
                              <div
                                key={index}
                                style={{
                                  position: 'absolute',
                                  left: `${area.x}px`,
                                  top: `${area.y}px`,
                                  width: `${area.width}px`,
                                  height: `${area.height}px`,
                                  fontSize: fontSize === 'smaller' ? '12px' : 
                                            fontSize === 'small' ? '14px' : 
                                            fontSize === 'medium' ? '16px' : 
                                            fontSize === 'large' ? '18px' : '20px',
                                  fontFamily: fontFamily,
                                  color: textColor,
                                  backgroundColor: backgroundColor,
                                  textAlign: textAlignment as any,
                                  lineHeight: `${lineSpacing / 100}`,
                                  padding: '4px',
                                  borderRadius: '2px',
                                  wordBreak: 'break-word',
                                  overflow: 'hidden'
                                }}
                              >
                                {translatedText}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    
                    {isProcessing && (
                      <div className="mt-4 p-3 bg-primary/10 rounded-md">
                        <p className="text-sm">{processingStep}</p>
                      </div>
                    )}
                    
                    {translatedTexts.length > 0 && (
                      <div className="mt-4">
                        <Button
                          onClick={handleSaveSettings}
                          variant="outline"
                          size="sm"
                        >
                          <Save className="w-4 h-4 mr-2" />
                          保存设置
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
            
            {/* 右侧：样式调整 */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>样式调整</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* 目标语言 */}
                    <div className="space-y-2">
                      <Label htmlFor="target-language">目标语言</Label>
                      <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                        <SelectTrigger id="target-language">
                          <SelectValue placeholder="选择目标语言" />
                        </SelectTrigger>
                        <SelectContent>
                          {languageOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {/* 样式保持程度 */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="style-level">样式保持程度</Label>
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
                        <span>{styleLevel}%</span>
                        <span>更美观</span>
                      </div>
                    </div>
                    
                    {/* 文本颜色 */}
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
                    
                    {/* 背景颜色 */}
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
                    
                    {/* 字体 */}
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
                    
                    {/* 字体大小 */}
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
                    
                    {/* 文本对齐 */}
                    <div className="space-y-2">
                      <Label htmlFor="text-alignment">文本对齐</Label>
                      <Select value={textAlignment} onValueChange={(value) => setTextAlignment(value as 'left' | 'center' | 'right')}>
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
                    
                    {/* 行间距 */}
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
                    
                    {/* 显示原文 */}
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
                        onCheckedChange={(checked) => updateAdvancedSettings({ showOriginalText: checked })}
                      />
                    </div>
                    
                    {/* 重置按钮 */}
                    <div className="mt-6">
                      <Button
                        onClick={handleResetSettings}
                        variant="outline"
                        className="w-full"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        重置所有设置
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TranslationPreview;