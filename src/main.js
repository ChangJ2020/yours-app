import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router/index.js'
import './assets/styles/base.css'
import './assets/styles/components.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.mount('#app')

// 开发环境下暴露实例，便于自动化验证脚本（scripts/e2e-verify.mjs）读取真实状态；生产构建不包含
if (import.meta.env.DEV) {
  window.__YA_PINIA__ = pinia
  window.__YA_APP__ = app
}
