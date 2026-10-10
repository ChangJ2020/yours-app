import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import AppDetailView from '@/views/AppDetailView.vue'

/** 使用 hash 路由：双击 dist/index.html 也能正常跳转 */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: 'AI 创想与应用管理中心' } },
    {
      path: '/app/:appId',
      name: 'app-detail',
      component: AppDetailView,
      props: true,
      meta: { title: 'App 工作台' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const base = 'Yours App (YA)'
  document.title = to.name === 'home' ? `${base} · 自然语言零代码应用生成工作台` : `${base} · ${to.meta?.title || ''}`
})

export default router
