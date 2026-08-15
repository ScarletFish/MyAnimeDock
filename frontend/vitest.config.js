import { defineConfig } from 'vitest/config';

// vitest 配置：SSE 同步模块是纯 JS、无 Svelte/DOM 依赖，配置保持最简。
// 不引入 svelte 插件，避免测试环境加载组件相关依赖。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});