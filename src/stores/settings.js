import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  LLM_ERROR_HINT,
  isLlmReady,
  loadLlmConfig,
  resolveLlmConfig,
  saveLlmConfig,
} from '@/engine/llmClient.js'
import { apiKeyFingerprint, readEnvLlmConfig } from '@/config/runtimeConfig.js'

const THEME_KEY = 'ya:theme'

/** 只把用户可编辑、且允许落盘的字段写入 localStorage（环境变量里的 Key 永不落盘） */
function persistable(config) {
  return {
    enabled: Boolean(config.enabled),
    forceLocal: Boolean(config.forceLocal),
    baseUrl: config.baseUrl || '',
    model: config.model || '',
    temperature: Number(config.temperature ?? 0.3),
    stream: config.stream !== false,
    // 只有用户自己填的 Key 才保存（来自环境变量的 Key 不写本地）
    apiKey: config.apiKeySource === 'env' ? '' : config.apiKey || '',
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref(localStorage.getItem(THEME_KEY) || 'light')
  const llm = ref(loadLlmConfig())

  const envConfig = readEnvLlmConfig()

  /** 生效配置：环境变量优先，含来源标记 */
  const effectiveLlm = computed(() => resolveLlmConfig(llm.value))
  const llmReady = computed(() => isLlmReady(effectiveLlm.value))
  const aiMode = computed(() => llmReady.value && !llm.value.forceLocal)
  const aiModeLabel = computed(() => (aiMode.value ? `AI 对话 · ${effectiveLlm.value.model}` : '内置引擎模式'))
  const keyFingerprint = computed(() => apiKeyFingerprint(effectiveLlm.value.apiKey))
  const envAvailable = computed(() => Boolean(envConfig.enabled && envConfig.apiKey))
  const envInfo = computed(() => ({
    available: envAvailable.value,
    baseUrl: envConfig.baseUrl,
    model: envConfig.model,
    keyFingerprint: apiKeyFingerprint(envConfig.apiKey),
  }))

  function applyTheme() {
    document.documentElement.dataset.theme = theme.value
  }

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  function updateLlm(patch) {
    llm.value = { ...llm.value, ...patch }
  }

  /** 一键切换：AI 对话 ⇄ 内置引擎（明确记录用户意图，避免被环境配置覆盖） */
  function setAiMode(next) {
    llm.value = { ...llm.value, forceLocal: !next, enabled: next ? true : llm.value.enabled }
  }

  function resetLlm() {
    llm.value = { ...loadLlmConfig(), forceLocal: false }
  }

  function errorHint(kind) {
    return LLM_ERROR_HINT[kind] || LLM_ERROR_HINT.unknown
  }

  watch(theme, (v) => {
    localStorage.setItem(THEME_KEY, v)
    applyTheme()
  })

  watch(
    llm,
    (v) => {
      saveLlmConfig(persistable(resolveLlmConfig(v)))
    },
    { deep: true },
  )

  applyTheme()

  return {
    theme,
    llm,
    envConfig,
    envInfo,
    envAvailable,
    effectiveLlm,
    llmReady,
    aiMode,
    aiModeLabel,
    keyFingerprint,
    toggleTheme,
    applyTheme,
    updateLlm,
    setAiMode,
    resetLlm,
    errorHint,
  }
})
