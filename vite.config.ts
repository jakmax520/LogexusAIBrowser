import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './manifest.json';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  // 生产构建剥离 console.* / debugger，开发模式保留日志
  esbuild: mode === 'production' ? { drop: ['console', 'debugger'] } : undefined,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
}));
