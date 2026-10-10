import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  buildApp,
  countRecordsByApp,
  getApp,
  listApps,
  removeApp,
  rebuildApp,
} from '@/services/storageService.js'
import { migrateRecords } from '@/engine/diff.js'

export const useAppsStore = defineStore('apps', () => {
  const apps = ref([])
  const recordCounts = ref({})
  const loading = ref(false)
  const lastBuiltId = ref('') // 用于首页高亮动效
  const error = ref('')

  const totalRecords = computed(() => Object.values(recordCounts.value).reduce((a, b) => a + b, 0))

  async function refresh() {
    loading.value = true
    error.value = ''
    try {
      const [list, counts] = await Promise.all([listApps(), countRecordsByApp()])
      apps.value = list
      recordCounts.value = counts
    } catch (e) {
      error.value = e?.message || '读取本地数据失败'
      apps.value = []
    } finally {
      loading.value = false
    }
  }

  function countOf(appId) {
    return recordCounts.value[appId] || 0
  }

  /** 首次构建 */
  async function create(spec) {
    const saved = await buildApp(spec)
    await refresh()
    lastBuiltId.value = saved.appId
    setTimeout(() => {
      if (lastBuiltId.value === saved.appId) lastBuiltId.value = ''
    }, 4000)
    return saved
  }

  /** 重新构建（含数据无损迁移） */
  async function rebuild({ currentSpec, nextSpec, changeNotes }) {
    const result = await rebuildApp({
      currentSpec,
      nextSpec,
      migrate: migrateRecords,
      changeNotes,
    })
    await refresh()
    return result
  }

  async function remove(appId) {
    const res = await removeApp(appId)
    await refresh()
    return res
  }

  async function fetchOne(appId) {
    return getApp(appId)
  }

  /** 记录数本地自增（提交表单后无需整表刷新） */
  function bumpCount(appId, delta = 1) {
    recordCounts.value = { ...recordCounts.value, [appId]: Math.max(0, (recordCounts.value[appId] || 0) + delta) }
  }

  return {
    apps,
    recordCounts,
    loading,
    error,
    lastBuiltId,
    totalRecords,
    refresh,
    create,
    rebuild,
    remove,
    fetchOne,
    countOf,
    bumpCount,
  }
})
