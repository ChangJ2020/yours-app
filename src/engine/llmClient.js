/**
 * Yours App (YA) · LLM 适配层（可选能力）
 * ------------------------------------------------------------------
 * 默认走本地规则引擎；当用户在设置里配置了 OpenAI 兼容接口后，
 * 自动切换为真实大模型生成（流式输出），失败时无缝回退本地引擎。
 * 配置仅保存在浏览器本地，不会上传到任何第三方服务。
 */

import { buildMessages, extractSpecJson } from './prompt.js'

export const LLM_STORAGE_KEY = 'ya:llm-config'

export const DEFAULT_LLM_CONFIG = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.3,
  stream: true,
}

export function loadLlmConfig() {
  try {
    const raw = localStorage.getItem(LLM_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_LLM_CONFIG }
    return { ...DEFAULT_LLM_CONFIG, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_LLM_CONFIG }
  }
}

export function saveLlmConfig(config) {
  try {
    localStorage.setItem(LLM_STORAGE_KEY, JSON.stringify(config))
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function isLlmReady(config) {
  return Boolean(config?.enabled && config?.apiKey && config?.baseUrl && config?.model)
}

/** 归一化 baseUrl，兼容用户填写 https://api.deepseek.com 或 .../v1/chat/completions */
function resolveEndpoint(baseUrl) {
  let url = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!url) throw new Error('接口地址为空')
  if (/\/chat\/completions$/.test(url)) return url
  if (/\/v\d+$/.test(url)) return `${url}/chat/completions`
  return `${url}/v1/chat/completions`
}

/**
 * 调用 OpenAI 兼容的 Chat Completions 接口
 * @param {object} params
 * @param {object} params.config
 * @param {Array} params.messages
 * @param {(chunk:string)=>void} [params.onDelta] 流式回调
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<string>} 完整文本
 */
export async function chatCompletion({ config, messages, onDelta, signal }) {
  const endpoint = resolveEndpoint(config.baseUrl)
  const stream = config.stream !== false

  const res = await fetch(endpoint, {
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
    }),
    signal,
  })

  if (!res.ok) {
    let detail = ''
    try {
      const data = await res.json()
      detail = data?.error?.message || data?.message || JSON.stringify(data).slice(0, 200)
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new Error(`模型接口返回 ${res.status}：${detail || res.statusText}`)
  }

  if (!stream || !res.body) {
    const data = await res.json()
    return data?.choices?.[0]?.message?.content ?? ''
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let full = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        const delta = json?.choices?.[0]?.delta?.content || json?.choices?.[0]?.message?.content || ''
        if (delta) {
          full += delta
          onDelta?.(delta)
        }
      } catch {
        /* 忽略半包 */
      }
    }
  }
  return full
}

/**
 * 统一的 Agent 调用入口：优先 LLM，不可用或失败时回退本地引擎
 */
export async function runAgentTurn({ config, stage, history, userText, currentSpec, featureList, wantSpec, onDelta, signal }) {
  if (!isLlmReady(config)) {
    return { ok: false, mode: 'local', reason: '未配置模型接口，使用内置生成引擎' }
  }
  const messages = buildMessages({ stage, history, userText, currentSpec, featureList, wantSpec })
  const text = await chatCompletion({ config, messages, onDelta, signal })
  return { ok: true, mode: 'llm', text, specDraft: extractSpecJson(text) }
}

/** 连通性自检（设置页「测试连接」按钮） */
export async function testConnection(config) {
  const text = await chatCompletion({
    config: { ...config, stream: false },
    messages: [
      { role: 'system', content: '你是连通性测试助手，只回复四个字：连接成功' },
      { role: 'user', content: 'ping' },
    ],
  })
  return String(text).trim().slice(0, 40)
}
