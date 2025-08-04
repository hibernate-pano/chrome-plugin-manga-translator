import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'path';
import manifest from './public/manifest.json';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/api': path.resolve(__dirname, './src/api'),
      '@/stores': path.resolve(__dirname, './src/stores'),
      '@/types': path.resolve(__dirname, './src/types')
    }
  },
  build: {
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: process.env.NODE_ENV === 'production',
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.debug'],
      },
      mangle: {
        safari10: true,
      },
    },
    rollupOptions: {
      input: {
        popup: 'src/popup.tsx',
        options: 'src/options.tsx',
        background: 'src/background/background.ts',
        content: 'src/content/content.tsx',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks: {
          // 将React相关库分离到单独的chunk
          'react-vendor': ['react', 'react-dom'],
          // 将查询库分离
          'query-vendor': ['@tanstack/react-query'],
          // 将状态管理分离
          'state-vendor': ['zustand'],
          // 将工具库分离
          'utils-vendor': ['clsx', 'class-variance-authority'],
        },
      },
    },
    // 启用代码分割
    chunkSizeWarningLimit: 1000,
    // 优化依赖预构建
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        '@tanstack/react-query',
        'zustand',
        'clsx',
        'class-variance-authority',
      ],
    },
  },
  // 开发服务器优化
  server: {
    hmr: {
      overlay: false,
    },
  },
  // 定义环境变量
  define: {
    __DEV__: process.env.NODE_ENV === 'development',
  },
});
