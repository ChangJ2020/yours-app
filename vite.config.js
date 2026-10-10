import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5273,
    strictPort: false,
    watch: {
      /**
       * 忽略非源码目录，避免两类问题：
       * 1. Chrome 验证用的用户数据目录被监听导致 EBUSY 崩溃；
       * 2. 编辑器自动保存产生的隐藏临时目录（*.tmpdir）在 Windows 上被占用。
       * 隐藏目录名以「.」开头，且以 tmpdir 结尾，源码目录下不会出现。
       */
      ignored: [
        '**/.*/**',
        '**/.*tmpdir/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/verify-shots/**',
        '**/.npmcache/**',
      ],
    },
  },
  build: {
    outDir: 'dist',
    // 单文件产物体积可控，便于离线分发
    chunkSizeWarningLimit: 1200,
  },
})
