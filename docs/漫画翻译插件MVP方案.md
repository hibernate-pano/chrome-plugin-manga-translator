# 漫画翻译插件MVP方案

## 1. 项目概述

### 1.1 背景与目标

"漫画翻译助手"是一款Chrome插件，旨在帮助用户翻译外文漫画。MVP版本将聚焦于基本功能的实现，采用简单的"贴片"方式来呈现翻译结果，而不过度追求与原始字体样式的完美匹配。

### 1.2 MVP核心理念

- **功能优先**：确保核心翻译流程正常工作
- **多API支持**：不依赖单一AI提供商，支持多种API选择
- **简单可靠**：采用成熟技术和简化流程，确保稳定性
- **快速迭代**：建立基础版本后，根据用户反馈逐步改进

## 2. 功能设计

### 2.1 MVP核心功能

1. **文字区域检测**：识别漫画图像中的文字区域
2. **文字提取与翻译**：提取区域中的文字并翻译成目标语言
3. **翻译结果展示**：使用简单的贴片方式展示翻译结果
4. **多API支持**：支持OpenAI、DeepSeek、Anthropic等多种AI服务提供商
5. **基本设置**：API密钥配置、目标语言选择、翻译开关
6. **翻译模式**：支持手动模式（点击图片翻译）和自动模式

### 2.2 功能优先级

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 多API支持 | 高 | 确保用户可以使用不同的API服务 |
| 手动翻译模式 | 高 | 用户点击图片进行翻译 |
| 简单贴片渲染 | 高 | 使用基本的文本框显示翻译结果 |
| 自动翻译模式 | 中 | 自动检测并翻译页面上的漫画图像 |
| 结果缓存 | 中 | 避免重复翻译相同内容 |
| 样式基本调整 | 低 | 提供简单的字体大小、颜色调整 |

## 3. 技术方案

### 3.1 API集成设计

#### 3.1.1 统一API抽象层

设计一个抽象层来统一不同AI服务的接口，使得切换服务提供商变得简单：

```javascript
// 抽象API接口示例
class AIProvider {
  constructor(config) {
    this.config = config;
  }
  
  async detectText(imageData) { /* 由具体实现类提供 */ }
  async translateText(text, targetLang) { /* 由具体实现类提供 */ }
}

// 具体实现示例
class OpenAIProvider extends AIProvider {
  async detectText(imageData) {
    // OpenAI Vision API实现
  }
  
  async translateText(text, targetLang) {
    // OpenAI Chat API实现
  }
}

class DeepSeekProvider extends AIProvider {
  // DeepSeek API实现
}

class OpenRouterProvider extends AIProvider {
  // OpenRouter API实现
}
```

#### 3.1.2 支持的API服务

MVP阶段将支持以下AI服务提供商：

1. **OpenAI** (GPT-4V/GPT-3.5)
   - Vision API用于检测文字区域
   - Chat API用于翻译文字

2. **DeepSeek**
   - DeepSeek-VL用于文字识别
   - DeepSeek-Coder或Chat用于翻译

3. **OpenRouter**
   - 作为代理，可访问多种模型

4. **Anthropic Claude**
   - 用于文本翻译和多模态检测

### 3.2 简化的工作流程

为MVP版本简化工作流程，降低复杂性：

1. **检测阶段**：使用AI视觉模型识别文字区域
2. **翻译阶段**：将提取的文字发送给AI翻译
3. **渲染阶段**：使用简单的HTML/CSS叠加层展示翻译结果，不追求复杂的Canvas渲染

### 3.3 翻译结果渲染

MVP阶段采用简单但有效的贴片方式：

1. 在原图像上方创建一个绝对定位的div层
2. 根据检测到的文字区域位置，放置相应的翻译文本框
3. 文本框使用半透明背景，基本的字体样式
4. 提供简单的样式调整（字号大小、背景透明度）

```javascript
// 简化的渲染示例
function renderTranslation(image, textAreas, translations) {
  const overlay = document.createElement('div');
  overlay.className = 'manga-translation-overlay';
  overlay.style.position = 'absolute';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.pointerEvents = 'none';
  
  textAreas.forEach((area, index) => {
    const textBox = document.createElement('div');
    textBox.className = 'manga-translation-text';
    textBox.textContent = translations[index] || '';
    textBox.style.position = 'absolute';
    textBox.style.left = `${area.x}px`;
    textBox.style.top = `${area.y}px`;
    textBox.style.width = `${area.width}px`;
    textBox.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
    textBox.style.padding = '5px';
    textBox.style.borderRadius = '3px';
    textBox.style.fontSize = '14px';
    
    overlay.appendChild(textBox);
  });
  
  // 添加覆盖层到图像容器
  const container = document.createElement('div');
  container.style.position = 'relative';
  container.style.display = 'inline-block';
  
  // 替换原始图像
  const parent = image.parentNode;
  parent.insertBefore(container, image);
  container.appendChild(image);
  container.appendChild(overlay);
  
  return container;
}
```

## 4. 架构设计

### 4.1 模块划分

MVP版本仍保持模块化设计，但简化模块内部实现：

1. **Provider模块**：处理不同API服务的集成
   - api/providers/openai.js
   - api/providers/deepseek.js
   - api/providers/openrouter.js
   - api/providers/anthropic.js
   - api/provider-factory.js (工厂模式创建提供者)

2. **Core模块**：核心处理逻辑
   - core/detector.js (文字区域检测)
   - core/translator.js (文字翻译)
   - core/renderer.js (简化的结果渲染)

3. **UI模块**：用户界面组件
   - ui/popup/ (弹出界面)
   - ui/options/ (选项页面)

4. **Utils模块**：辅助工具函数
   - utils/storage.js (配置和缓存存储)
   - utils/image-process.js (基本图像处理)

### 4.2 数据流

简化的数据流程：

1. 用户触发翻译（点击图像或自动模式）
2. 将图像数据发送给选定的AI提供商进行文字区域检测
3. 获取文字区域和内容后，发送给AI进行翻译
4. 使用简单的HTML叠加层渲染翻译结果
5. 缓存结果以提高后续使用效率

## 5. 开发计划

### 5.1 MVP开发阶段

| 阶段 | 任务 | 时间估计 |
|------|------|----------|
| **阶段1：基础框架** | 设置项目结构<br>创建API抽象层<br>实现基本UI组件 | 1周 |
| **阶段2：OpenAI集成** | 实现OpenAI提供者<br>完成文字检测和翻译功能<br>构建基本渲染逻辑 | 1周 |
| **阶段3：多API支持** | 实现DeepSeek提供者<br>实现OpenRouter提供者<br>实现Anthropic提供者 | 1-2周 |
| **阶段4：功能完善** | 实现手动和自动模式<br>添加缓存机制<br>完善设置选项 | 1周 |
| **阶段5：测试与调优** | 功能测试<br>性能优化<br>解决兼容性问题 | 1周 |

总计时间：5-6周

### 5.2 后续迭代计划

MVP发布后的迭代方向：

1. **渲染优化**：改进翻译文本的显示效果
2. **性能优化**：引入Web Worker处理耗时操作
3. **API融合**：探索"一次调用"模式，同时完成检测和翻译
4. **用户体验**：添加更多自定义选项和交互功能

## 6. 技术选型

### 6.1 前端技术

- **框架**：React.js
- **样式**：TailwindCSS
- **构建工具**：Vite
- **Chrome API**：Chrome Extension API (Manifest V3)

### 6.2 核心技术

- **API集成**：Fetch API、异步处理
- **图像处理**：HTML Canvas API（基础操作）
- **存储**：Chrome Storage API
- **UI状态管理**：React Context API（简单状态）

## 7. 注意事项与挑战

### 7.1 潜在挑战

1. **API成本控制**：多次API调用可能导致成本增加
   - 解决方案：实施有效的缓存策略和用量控制

2. **跨域问题**：获取第三方网站图像可能面临跨域限制
   - 解决方案：使用插件特权API或CORS代理

3. **性能影响**：在主线程中处理图像和API调用可能影响性能
   - 解决方案：优化调用逻辑，考虑未来引入Web Worker

### 7.2 安全考虑

1. **API密钥安全**：保护用户的API密钥
   - 实施：使用Chrome的安全存储，限制API密钥的访问范围

2. **数据隐私**：确保用户数据安全
   - 实施：明确的隐私政策，本地处理数据，避免不必要的数据传输

## 8. 结论

这个MVP方案专注于快速实现漫画翻译插件的核心功能，同时确保支持多种API服务提供商。采用简单的"贴片"渲染方式，避免过度复杂的样式匹配，使得项目可以在较短时间内完成并投入使用。

后续迭代将根据用户反馈，逐步改进翻译质量、渲染效果和性能表现，最终实现一个功能完善、用户友好的漫画翻译工具。 