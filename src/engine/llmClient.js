/**
 * Yours App (YA) · LLM 适配层
 * ------------------------------------------------------------------
 * 职责：把「用户这一轮说了什么 + 当前应用上下文」发给 OpenAI 兼容接口，
 * 流式返回文本，并在模型给出结构化 App Spec 时解析出来。
 *
 * 配置优先级：环境变量（.env.local） > 浏览器本地设置（⚙️ 面板）
 * 失败时抛出带分类的错误，由上层决定「提示用户」还是「降级到内置引擎」——
 * 本层不做静默回退，保证问题可见。
 */

import { buildMessages, extractSpecJson } from './prompt.js'
// 说明：这里用 Node 原生支持的 package imports（#src/*），而不是 Vite 专属的 @ 别名，
// 这样引擎层可以在 `npm test` 里被 Node 直接加载，无需额外构建步骤。
import { hasEnvLlmConfig, readEnvLlmConfig } from '#src/config/runtimeConfig.js'

export const LLM_STORAGE_KEY = 'ya:llm-config'

/** 只保存「用户是否显式改过」的字段；空字符串代表未设置 */
export const DEFAULT_LLM_CONFIG = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.3,
  stream: true,
}

export function loadLlmConfig() {
  const envConfig = readEnvLlmConfig()
  const fallback = {
    ...DEFAULT_LLM_CONFIG,
    // 环境变量提供了默认值，但用户仍可在 ⚙️ 面板里覆盖
    baseUrl: envConfig.baseUrl || DEFAULT_LLM_CONFIG.baseUrl,
    model: envConfig.model || DEFAULT_LLM_CONFIG.model,
    temperature: Number.isFinite(envConfig.temperature) ? envConfig.temperature : DEFAULT_LLM_CONFIG.temperature,
    stream: envConfig.stream !== false,
  }
  try {
    const raw = localStorage.getItem(LLM_STORAGE_KEY)
    if (!raw) return { ...fallback, enabled: envConfig.enabled || DEFAULT_LLM_CONFIG.enabled }
    const saved = JSON.parse(raw)
    return {
      ...fallback,
      ...saved,
      // 空字符串视为「用户没填」，回退到环境变量值，避免覆盖掉环境配置
      baseUrl: saved.baseUrl && String(saved.baseUrl).trim() ? saved.baseUrl : fallback.baseUrl,
      model: saved.model && String(saved.model).trim() ? saved.model : fallback.model,
      // 用户在面板里显式开关过，就以面板为准；否则用环境变量的开关
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : envConfig.enabled || fallback.enabled,
    }
  } catch {
    return fallback
  }
}

export function saveLlmConfig(config) {
  try {
    localStorage.setItem(LLM_STORAGE_KEY, JSON.stringify(config))
  } catch {
    /* 隐私模式下忽略 */
  }
}

/** 组装「最终生效」的配置：环境变量里的 Key 始终优先（不落本地存储） */
export function resolveLlmConfig(config) {
  const envConfig = readEnvLlmConfig()
  const merged = {
    ...DEFAULT_LLM_CONFIG,
    ...(config || {}),
  }
  if (envConfig.baseUrl) merged.baseUrl = envConfig.baseUrl
  if (envConfig.model) merged.model = envConfig.model
  if (envConfig.apiKey) merged.apiKey = envConfig.apiKey
  if (envConfig.enabled) merged.enabled = true
  merged.apiKeySource = envConfig.apiKey ? 'env' : config?.apiKey ? 'local' : 'none'
  merged.baseUrlSource = envConfig.baseUrl ? 'env' : config?.baseUrl ? 'local' : 'none'
  merged.envAvailable = hasEnvLlmConfig()
  return merged
}

export function isLlmReady(config) {
  const c = config?.apiKeySource ? config : resolveLlmConfig(config)
  return Boolean(c?.enabled && c?.apiKey && c?.baseUrl && c?.model)
}

/** 归一化 baseUrl，兼容 https://api.deepseek.com 或 .../v1/chat/completions */
export function resolveEndpoint(baseUrl) {
  let url = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!url) throw new LlmError('接口地址为空，请在 ⚙️ 设置或 .env.local 中填写', 'config')
  if (/\/chat\/completions$/.test(url)) return url
  if (/\/v\d+$/.test(url)) return `${url}/chat/completions`
  return `${url}/v1/chat/completions`
}

/** 带分类的模型调用错误，便于界面给出可操作提示 */
export class LlmError extends Error {
  constructor(message, kind = 'unknown', detail = '') {
    super(message)
    this.name = 'LlmError'
    this.kind = kind // config | auth | rate_limit | network | server | aborted | empty | unknown
    this.detail = detail
  }
}

export const LLM_ERROR_HINT = {
  config: '请检查接口地址、模型名与 Key 是否填写完整',
  auth: 'API Key 无效或无权限，请更换 Key 后重试',
  rate_limit: '触发频率或额度限制，请稍后重试或检查账户余额',
  network: '网络不可达：请确认本机能访问该接口（也可能是 CORS 被拦截）',
  server: '模型服务端异常，可稍后重试',
  aborted: '已手动停止本次生成',
  empty: '模型返回了空内容，请重试',
  unknown: '未知错误，可查看浏览器控制台获取详情',
}

function classifyStatus(status, detail = '') {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'server'
  if (/api key|unauthorized|invalid.*key/i.test(detail)) return 'auth'
  if (/quota|balance|insufficient/i.test(detail)) return 'rate_limit'
  return 'unknown'
}

/**
 * 调用 OpenAI 兼容的 Chat Completions 接口
 * @param {object} params
 * @param {object} params.config 已 resolve 的配置
 * @param {Array} params.messages
 * @param {(chunk:string)=>void} [params.onDelta] 流式回调
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{text:string, usage:object|null, model:string, latencyMs:number}>}
 */
export async function chatCompletion({ config, messages, onDelta, signal }) {
  const endpoint = resolveEndpoint(config.baseUrl)
  const stream = config.stream !== false
  const startedAt = Date.now()

  let res
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: Number(config.temperature ?? 0.3),
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      }),
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw new LlmError('已停止生成', 'aborted')
    throw new LlmError(`网络请求失败：${e?.message || e}`, 'network', String(e))
  }

  if (!res.ok) {
    let detail = ''
    try {
      const data = await res.json()
      detail = data?.error?.message || data?.message || JSON.stringify(data).slice(0, 300)
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new LlmError(`模型接口返回 ${res.status}：${detail || res.statusText}`, classifyStatus(res.status, detail), detail)
  }

  // 非流式
  if (!stream || !res.body) {
    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content ?? ''
    return {
      text,
      usage: data?.usage || null,
      model: data?.model || config.model,
      latencyMs: Date.now() - startedAt,
    }
  }

  // 流式（SSE）
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let full = ''
  let usage = null
  let model = config.model

  const handleLine = (line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    try {
      const json = JSON.parse(payload)
      if (json?.model) model = json.model
      if (json?.usage) usage = json.usage
      const delta = json?.choices?.[0]?.delta?.content || json?.choices?.[0]?.message?.content || ''
      if (delta) {
        full += delta
        onDelta?.(delta)
      }
    } catch {
      /* 半包/心跳，忽略 */
    }
  }

  while (true) {
    let chunk
    try {
      chunk = await reader.read()
    } catch (e) {
      if (e?.name === 'AbortError') throw new LlmError('已停止生成', 'aborted')
      throw new LlmError(`读取流式响应失败：${e?.message || e}`, 'network', String(e))
    }
    const { value, done } = chunk
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(line)
  }
  if (buffer) handleLine(buffer)

  return { text: full, usage, model, latencyMs: Date.now() - startedAt }
}

/**
 * 统一的 Agent 调用入口
 * 需要结构化 Spec 时使用 tools（function calling）提高可靠性，不支持则回退到代码块解析。
 */
export async function runAgentTurn({
  config,
  stage,
  history,
  userText,
  currentSpec,
  featureList,
  wantSpec,
  onDelta,
  signal,
  onStage,
}) {
  const messages = buildMessages({ stage, history, userText, currentSpec, featureList, wantSpec })
  onStage?.('requesting')
  const { text, usage, model, latencyMs } = await chatCompletion({ config, messages, onDelta, signal })
  onStage?.('parsing')
  if (!text.trim()) throw new LlmError('模型没有返回任何内容', 'empty')
  return { text, specDraft: extractSpecJson(text), usage, model, latencyMs }
}

/** 连通性自检（设置页「测试连接」按钮） */
export async function testConnection(config) {
  const resolved = resolveLlmConfig(config)
  if (!isLlmReady(resolved)) {
    throw new LlmError('配置不完整：需要接口地址、模型名与 API Key', 'config')
  }
  const { text, latencyMs, model } = await chatCompletion({
    config: { ...resolved, stream: false },
    messages: [
      { role: 'system', content: '你是连通性测试助手，只回复四个字：连接成功' },
      { role: 'user', content: 'ping' },
    ],
  })
  return { reply: String(text).trim().slice(0, 60), latencyMs, model }
}
