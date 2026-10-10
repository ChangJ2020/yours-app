import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { DEFAULT_LLM_CONFIG, isLlmReady, loadLlmConfig, saveLlmConfig } from '@/engine/llmClient.js'

const THEME_KEY = 'ya:theme'

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref(localStorage.getItem(THEME_KEY) || 'light')
  const llm = ref(loadLlmConfig())

  const llmReady = computed(() => isLlmReady(llm.value))
  const modeLabel = computed(() => (llmReady.value ? `AI 模式 · ${llm.value.model}` : '内置引擎模式'))

  function applyTheme() {
    document.documentElement.dataset.theme = theme.value
  }

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  function updateLlm(patch) {
    llm.value = { ...llm.value, ...patch }
  }

  function resetLlm() {
    llm.value = { ...DEFAULT_LLM_CONFIG }
  }

  watch(theme, (v) => {
    localStorage.setItem(THEME_KEY, v)
    applyTheme()
  })

  watch(
    llm,
    (v) => {
      saveLlmConfig(JSON.parse(JSON.stringify(v)))
    },
    { deep: true },
  )

  applyTheme()

  return { theme, llm, llmReady, modeLabel, toggleTheme, applyTheme, updateLlm, resetLlm }
})
