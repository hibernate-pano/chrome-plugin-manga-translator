#!/bin/bash

# 修复TypeScript编译错误的脚本

echo "开始修复TypeScript错误..."

# 修复Map迭代器问题
echo "修复Map迭代器问题..."
find src -name "*.ts" -exec sed -i '' 's/for (const \[\([^]]*\)\] of \([^.]*\)\.entries())/for (const [\1] of Array.from(\2.entries()))/g' {} \;

# 修复未使用的React导入
echo "修复React导入问题..."
find src -name "*.tsx" -exec sed -i '' 's/import React, { /import { /g' {} \;
find src -name "*.tsx" -exec sed -i '' 's/^import React from '\''react'\'';$/\/\/ import React from '\''react'\'';/g' {} \;

# 修复未使用的参数（添加下划线前缀）
echo "修复未使用的参数..."
find src -name "*.ts" -name "*.tsx" -exec sed -i '' 's/\([a-zA-Z_][a-zA-Z0-9_]*\): [^,)]*,\?\([^)]*\))/\1: \2/g' {} \;

echo "TypeScript错误修复完成"
