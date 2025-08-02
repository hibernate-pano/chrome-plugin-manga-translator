/**
 * 文档生成工具
 * 自动生成API文档、组件文档和使用指南
 */

/**
 * 文档类型
 */
export type DocumentationType = 'api' | 'component' | 'hook' | 'utility' | 'guide';

/**
 * 文档项接口
 */
export interface DocumentationItem {
  name: string;
  type: DocumentationType;
  description: string;
  parameters?: Parameter[];
  returnType?: string;
  examples?: Example[];
  notes?: string[];
  deprecated?: boolean;
  since?: string;
  tags?: string[];
}

/**
 * 参数接口
 */
export interface Parameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

/**
 * 示例接口
 */
export interface Example {
  title: string;
  code: string;
  description?: string;
}

/**
 * 文档生成器类
 */
export class DocumentationGenerator {
  private items: Map<string, DocumentationItem> = new Map();

  /**
   * 添加文档项
   */
  addItem(item: DocumentationItem): void {
    this.items.set(item.name, item);
  }

  /**
   * 批量添加文档项
   */
  addItems(items: DocumentationItem[]): void {
    items.forEach(item => this.addItem(item));
  }

  /**
   * 生成Markdown文档
   */
  generateMarkdown(type?: DocumentationType): string {
    const filteredItems = type 
      ? Array.from(this.items.values()).filter(item => item.type === type)
      : Array.from(this.items.values());

    if (filteredItems.length === 0) {
      return '# 文档\n\n暂无文档内容。\n';
    }

    let markdown = `# ${this.getTypeTitle(type)} 文档\n\n`;
    
    // 生成目录
    markdown += '## 目录\n\n';
    filteredItems.forEach(item => {
      markdown += `- [${item.name}](#${this.generateAnchor(item.name)})\n`;
    });
    markdown += '\n';

    // 生成详细文档
    filteredItems.forEach(item => {
      markdown += this.generateItemMarkdown(item);
      markdown += '\n---\n\n';
    });

    return markdown;
  }

  /**
   * 生成单个项目的Markdown
   */
  private generateItemMarkdown(item: DocumentationItem): string {
    let markdown = `## ${item.name}\n\n`;

    // 添加标签
    if (item.tags && item.tags.length > 0) {
      markdown += `**标签:** ${item.tags.map(tag => `\`${tag}\``).join(', ')}\n\n`;
    }

    // 添加版本信息
    if (item.since) {
      markdown += `**自版本:** ${item.since}\n\n`;
    }

    // 添加弃用警告
    if (item.deprecated) {
      markdown += '> ⚠️ **已弃用** - 此功能已被弃用，请使用替代方案。\n\n';
    }

    // 添加描述
    markdown += `${item.description}\n\n`;

    // 添加参数
    if (item.parameters && item.parameters.length > 0) {
      markdown += '### 参数\n\n';
      markdown += '| 参数名 | 类型 | 必需 | 默认值 | 描述 |\n';
      markdown += '|--------|------|------|--------|------|\n';
      
      item.parameters.forEach(param => {
        const required = param.required ? '✅' : '❌';
        const defaultValue = param.defaultValue || '-';
        markdown += `| \`${param.name}\` | \`${param.type}\` | ${required} | \`${defaultValue}\` | ${param.description} |\n`;
      });
      markdown += '\n';
    }

    // 添加返回类型
    if (item.returnType) {
      markdown += `### 返回值\n\n\`${item.returnType}\`\n\n`;
    }

    // 添加示例
    if (item.examples && item.examples.length > 0) {
      markdown += '### 示例\n\n';
      item.examples.forEach((example, index) => {
        markdown += `#### ${example.title}\n\n`;
        if (example.description) {
          markdown += `${example.description}\n\n`;
        }
        markdown += '```typescript\n';
        markdown += example.code;
        markdown += '\n```\n\n';
      });
    }

    // 添加注意事项
    if (item.notes && item.notes.length > 0) {
      markdown += '### 注意事项\n\n';
      item.notes.forEach(note => {
        markdown += `- ${note}\n`;
      });
      markdown += '\n';
    }

    return markdown;
  }

  /**
   * 生成HTML文档
   */
  generateHTML(type?: DocumentationType): string {
    const markdown = this.generateMarkdown(type);
    
    // 简单的Markdown到HTML转换
    const html = markdown
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(.+)$/gm, '<p>$1</p>');

    // 包装在HTML文档中
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.getTypeTitle(type)} 文档</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 1200px; margin: 0 auto; padding: 20px; }
        h1, h2, h3, h4 { color: #333; }
        code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
        pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .deprecated { background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 5px; margin: 10px 0; }
    </style>
</head>
<body>
    ${html}
</body>
</html>`;
  }

  /**
   * 生成JSON文档
   */
  generateJSON(type?: DocumentationType): string {
    const filteredItems = type 
      ? Array.from(this.items.values()).filter(item => item.type === type)
      : Array.from(this.items.values());

    return JSON.stringify({
      type: type || 'all',
      generatedAt: new Date().toISOString(),
      items: filteredItems,
    }, null, 2);
  }

  /**
   * 获取类型标题
   */
  private getTypeTitle(type?: DocumentationType): string {
    const titles = {
      api: 'API',
      component: '组件',
      hook: 'Hook',
      utility: '工具函数',
      guide: '使用指南',
    };

    return type ? titles[type] : '完整';
  }

  /**
   * 生成锚点
   */
  private generateAnchor(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  }

  /**
   * 清空文档
   */
  clear(): void {
    this.items.clear();
  }

  /**
   * 获取统计信息
   */
  getStats(): Record<DocumentationType, number> & { total: number } {
    const stats = {
      api: 0,
      component: 0,
      hook: 0,
      utility: 0,
      guide: 0,
      total: this.items.size,
    };

    this.items.forEach(item => {
      stats[item.type]++;
    });

    return stats;
  }
}

// 导出单例实例
export const documentationGenerator = new DocumentationGenerator();

/**
 * 预定义的文档项
 */
export const predefinedDocs: DocumentationItem[] = [
  {
    name: 'useTranslateText',
    type: 'hook',
    description: '用于翻译文本的React Hook，支持批量翻译和缓存。',
    parameters: [
      {
        name: 'options',
        type: 'TranslationOptions',
        description: '翻译选项配置',
        required: true,
      },
    ],
    returnType: 'TranslationResult',
    examples: [
      {
        title: '基本使用',
        code: `const { mutate: translateText, isLoading } = useTranslateText({
  provider: 'openai',
  targetLanguage: 'zh-CN',
});

translateText(['Hello, world!']);`,
        description: '翻译单个文本',
      },
    ],
    tags: ['translation', 'hook'],
    since: '0.2.0',
  },
  {
    name: 'PerformanceMonitor',
    type: 'component',
    description: '性能监控组件，显示实时性能指标和优化建议。',
    parameters: [
      {
        name: 'enableRealtime',
        type: 'boolean',
        description: '是否启用实时监控',
        required: false,
        defaultValue: 'true',
      },
    ],
    examples: [
      {
        title: '基本使用',
        code: `<PerformanceMonitor enableRealtime={true} />`,
        description: '显示性能监控面板',
      },
    ],
    tags: ['performance', 'monitoring'],
    since: '0.2.0',
  },
  {
    name: 'memoryOptimizer',
    type: 'utility',
    description: '内存优化工具，监控内存使用并提供优化建议。',
    examples: [
      {
        title: '开始监控',
        code: `import { memoryOptimizer } from '@/utils/memory-optimizer';

memoryOptimizer.startMonitoring();`,
        description: '启动内存监控',
      },
    ],
    tags: ['memory', 'optimization'],
    since: '0.2.0',
  },
];

/**
 * 初始化预定义文档
 */
export function initializePredefinedDocs(): void {
  documentationGenerator.addItems(predefinedDocs);
}

/**
 * 导出文档到文件
 */
export function exportDocumentation(
  format: 'markdown' | 'html' | 'json' = 'markdown',
  type?: DocumentationType
): string {
  switch (format) {
    case 'html':
      return documentationGenerator.generateHTML(type);
    case 'json':
      return documentationGenerator.generateJSON(type);
    case 'markdown':
    default:
      return documentationGenerator.generateMarkdown(type);
  }
}

/**
 * 自动生成组件文档
 */
export function generateComponentDoc(
  componentName: string,
  props: Record<string, any>,
  description: string
): DocumentationItem {
  const parameters: Parameter[] = Object.entries(props).map(([name, prop]) => ({
    name,
    type: typeof prop === 'object' && prop.type ? prop.type : typeof prop,
    description: prop.description || `${name} 属性`,
    required: prop.required || false,
    defaultValue: prop.defaultValue,
  }));

  return {
    name: componentName,
    type: 'component',
    description,
    parameters,
    tags: ['component', 'react'],
    since: '0.2.0',
  };
}
