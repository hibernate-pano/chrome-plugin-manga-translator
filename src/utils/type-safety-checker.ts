/**
 * 类型安全检查工具
 * 运行时类型验证和安全检查
 */

/**
 * 类型验证器接口
 */
export interface TypeValidator<T = any> {
  validate(value: unknown): value is T;
  getTypeName(): string;
  getErrorMessage(value: unknown): string;
}

/**
 * 基础类型验证器
 */
export class StringValidator implements TypeValidator<string> {
  validate(value: unknown): value is string {
    return typeof value === 'string';
  }

  getTypeName(): string {
    return 'string';
  }

  getErrorMessage(value: unknown): string {
    return `Expected string, got ${typeof value}`;
  }
}

export class NumberValidator implements TypeValidator<number> {
  validate(value: unknown): value is number {
    return typeof value === 'number' && !isNaN(value);
  }

  getTypeName(): string {
    return 'number';
  }

  getErrorMessage(value: unknown): string {
    return `Expected number, got ${typeof value}`;
  }
}

export class BooleanValidator implements TypeValidator<boolean> {
  validate(value: unknown): value is boolean {
    return typeof value === 'boolean';
  }

  getTypeName(): string {
    return 'boolean';
  }

  getErrorMessage(value: unknown): string {
    return `Expected boolean, got ${typeof value}`;
  }
}

/**
 * 数组验证器
 */
export class ArrayValidator<T> implements TypeValidator<T[]> {
  constructor(private itemValidator: TypeValidator<T>) {}

  validate(value: unknown): value is T[] {
    if (!Array.isArray(value)) {
      return false;
    }

    return value.every(item => this.itemValidator.validate(item));
  }

  getTypeName(): string {
    return `${this.itemValidator.getTypeName()}[]`;
  }

  getErrorMessage(value: unknown): string {
    if (!Array.isArray(value)) {
      return `Expected array, got ${typeof value}`;
    }

    const invalidIndex = value.findIndex(item => !this.itemValidator.validate(item));
    if (invalidIndex !== -1) {
      return `Invalid item at index ${invalidIndex}: ${this.itemValidator.getErrorMessage(value[invalidIndex])}`;
    }

    return `Invalid array of ${this.getTypeName()}`;
  }
}

/**
 * 对象验证器
 */
export class ObjectValidator<T extends Record<string, any>> implements TypeValidator<T> {
  constructor(private schema: { [K in keyof T]: TypeValidator<T[K]> }) {}

  validate(value: unknown): value is T {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const obj = value as Record<string, unknown>;

    for (const [key, validator] of Object.entries(this.schema)) {
      if (!validator.validate(obj[key])) {
        return false;
      }
    }

    return true;
  }

  getTypeName(): string {
    const fields = Object.entries(this.schema)
      .map(([key, validator]) => `${key}: ${validator.getTypeName()}`)
      .join(', ');
    return `{ ${fields} }`;
  }

  getErrorMessage(value: unknown): string {
    if (typeof value !== 'object' || value === null) {
      return `Expected object, got ${typeof value}`;
    }

    const obj = value as Record<string, unknown>;

    for (const [key, validator] of Object.entries(this.schema)) {
      if (!validator.validate(obj[key])) {
        return `Invalid property '${key}': ${validator.getErrorMessage(obj[key])}`;
      }
    }

    return `Invalid object of type ${this.getTypeName()}`;
  }
}

/**
 * 可选类型验证器
 */
export class OptionalValidator<T> implements TypeValidator<T | undefined> {
  constructor(private innerValidator: TypeValidator<T>) {}

  validate(value: unknown): value is T | undefined {
    return value === undefined || this.innerValidator.validate(value);
  }

  getTypeName(): string {
    return `${this.innerValidator.getTypeName()} | undefined`;
  }

  getErrorMessage(value: unknown): string {
    if (value === undefined) {
      return 'Value is undefined (which is valid)';
    }
    return this.innerValidator.getErrorMessage(value);
  }
}

/**
 * 联合类型验证器
 */
export class UnionValidator<T> implements TypeValidator<T> {
  constructor(private validators: TypeValidator<any>[]) {}

  validate(value: unknown): value is T {
    return this.validators.some(validator => validator.validate(value));
  }

  getTypeName(): string {
    return this.validators.map(v => v.getTypeName()).join(' | ');
  }

  getErrorMessage(value: unknown): string {
    const errors = this.validators.map(v => v.getErrorMessage(value));
    return `Value doesn't match any of: ${errors.join(', ')}`;
  }
}

/**
 * 类型安全检查器
 */
export class TypeSafetyChecker {
  private static instance: TypeSafetyChecker;
  private validators = new Map<string, TypeValidator>();

  static getInstance(): TypeSafetyChecker {
    if (!TypeSafetyChecker.instance) {
      TypeSafetyChecker.instance = new TypeSafetyChecker();
    }
    return TypeSafetyChecker.instance;
  }

  /**
   * 注册验证器
   */
  registerValidator<T>(name: string, validator: TypeValidator<T>): void {
    this.validators.set(name, validator);
  }

  /**
   * 验证值
   */
  validate<T>(value: unknown, validator: TypeValidator<T>): T {
    if (validator.validate(value)) {
      return value;
    }

    throw new TypeError(validator.getErrorMessage(value));
  }

  /**
   * 安全验证（不抛出异常）
   */
  safeValidate<T>(value: unknown, validator: TypeValidator<T>): { 
    success: boolean; 
    data?: T; 
    error?: string 
  } {
    try {
      const data = this.validate(value, validator);
      return { success: true, data };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown validation error' 
      };
    }
  }

  /**
   * 验证API响应
   */
  validateApiResponse<T>(response: unknown, validator: TypeValidator<T>): T {
    try {
      return this.validate(response, validator);
    } catch (error) {
      console.error('API响应验证失败:', error);
      throw new Error(`API响应格式错误: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 验证配置对象
   */
  validateConfig<T>(config: unknown, validator: TypeValidator<T>): T {
    try {
      return this.validate(config, validator);
    } catch (error) {
      console.error('配置验证失败:', error);
      throw new Error(`配置格式错误: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 验证存储数据
   */
  validateStorageData<T>(data: unknown, validator: TypeValidator<T>): T {
    try {
      return this.validate(data, validator);
    } catch (error) {
      console.error('存储数据验证失败:', error);
      throw new Error(`存储数据格式错误: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// 导出单例实例
export const typeSafetyChecker = TypeSafetyChecker.getInstance();

// 导出常用验证器实例
export const validators = {
  string: new StringValidator(),
  number: new NumberValidator(),
  boolean: new BooleanValidator(),
  stringArray: new ArrayValidator(new StringValidator()),
  numberArray: new ArrayValidator(new NumberValidator()),
  
  // 创建可选验证器的辅助函数
  optional: <T>(validator: TypeValidator<T>) => new OptionalValidator(validator),
  
  // 创建数组验证器的辅助函数
  array: <T>(validator: TypeValidator<T>) => new ArrayValidator(validator),
  
  // 创建对象验证器的辅助函数
  object: <T extends Record<string, any>>(schema: { [K in keyof T]: TypeValidator<T[K]> }) => 
    new ObjectValidator(schema),
  
  // 创建联合验证器的辅助函数
  union: <T>(...validators: TypeValidator<any>[]) => new UnionValidator<T>(validators),
};

/**
 * 常用类型验证器
 */
export const commonValidators = {
  // 翻译配置验证器
  translationConfig: validators.object({
    provider: validators.string,
    apiKey: validators.optional(validators.string),
    model: validators.optional(validators.string),
    temperature: validators.optional(validators.number),
    maxTokens: validators.optional(validators.number),
  }),

  // 翻译结果验证器
  translationResult: validators.object({
    text: validators.string,
    sourceLanguage: validators.string,
    targetLanguage: validators.string,
    confidence: validators.optional(validators.number),
    provider: validators.string,
  }),

  // 缓存项验证器
  cacheItem: validators.object({
    key: validators.string,
    value: validators.string, // 实际可能是any，但这里简化为string
    timestamp: validators.number,
    ttl: validators.optional(validators.number),
    tags: validators.optional(validators.stringArray),
  }),

  // 性能指标验证器
  performanceMetric: validators.object({
    name: validators.string,
    value: validators.number,
    unit: validators.string,
    timestamp: validators.number,
    category: validators.union(
      validators.string, // 简化处理，实际应该是具体的字符串字面量类型
    ),
  }),
};

/**
 * 装饰器：类型安全的方法
 */
export function TypeSafe<T>(validator: TypeValidator<T>) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      // 验证第一个参数
      if (args.length > 0) {
        try {
          args[0] = typeSafetyChecker.validate(args[0], validator);
        } catch (error) {
          console.error(`方法 ${propertyKey} 参数验证失败:`, error);
          throw error;
        }
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * 运行时类型断言
 */
export function assertType<T>(value: unknown, validator: TypeValidator<T>, message?: string): asserts value is T {
  if (!validator.validate(value)) {
    const errorMessage = message || validator.getErrorMessage(value);
    throw new TypeError(`类型断言失败: ${errorMessage}`);
  }
}

/**
 * 类型守卫辅助函数
 */
export function isType<T>(value: unknown, validator: TypeValidator<T>): value is T {
  return validator.validate(value);
}

/**
 * 安全的JSON解析
 */
export function safeJsonParse<T>(json: string, validator: TypeValidator<T>): T {
  try {
    const parsed = JSON.parse(json);
    return typeSafetyChecker.validate(parsed, validator);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`JSON解析失败: ${error.message}`);
    }
    throw error;
  }
}
