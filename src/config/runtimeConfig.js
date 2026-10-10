/**
 * Yours App (YA) · 运行时配置层
 * ------------------------------------------------------------------
 * AI 对话所需的接口配置有两种来源，优先级：环境变量 > 浏览器本地设置。
 *
 *   1. 环境变量（推荐，团队/本机统一配置）
 *      在工程根目录创建 `.env.local`（已被 .gitignore 忽略），写入：
 *        VITE_YA_LLM_BASE_URL=https://api.deepseek.com/v1
 *        VITE_YA_LLM_MODEL=deepseek-chat
 *        VITE_YA_LLM_API_KEY=sk-xxxx
 *        VITE_YA_LLM_ENABLED=true
 *      由 Vite 在构建/启动时注入到前端，用户打开页面即可直接用 AI，无需自己填写。
 *
 *   2. 浏览器本地设置（⚙️ 面板里填写，保存在 localStorage）
 *      适合临时试用或每个使用者自带 Key。
 *
 * ⚠️ 安全边界：本项目是纯前端应用，注入到前端的变量会被打进入口 JS。
 *    这意味着 —— 本机自用没问题；**不要把带 Key 的 dist/ 发布到公网**。
 *    若将来要公开部署，应把 `src/engine/llmClient.js` 的请求改指向自建后端代理，
 *    由后端保管 Key（前端只发对话内容）。
 */

/** 读取 Vite 注入的环境变量（在 Node 测试环境下 import.meta.env 可能不存在） */
function env() {
  try {
    return import.meta?.env || {}
  } catch {
    return {}
  }
}

const pick = (...values) => values.find((v) => v !== undefined && v !== null && String(v).trim() !== '')

const asBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback
  return /^(1|true|yes|on)$/i.test(String(value).trim())
}

/** 生成一个能安全打日志的 Key 指纹，便于确认「到底用的是哪把 Key」 */
export function apiKeyFingerprint(key) {
  const k = String(key || '').trim()
  if (!k) return ''
  if (k.length <= 10) return `${k.slice(0, 2)}***`
  return `${k.slice(0, 3)}***${k.slice(-4)}（共 ${k.length} 位）`
}

/**
 * 环境变量里的模型配置
 * @returns {{enabled:boolean, baseUrl:string, model:string, apiKey:string, temperature:number, stream:boolean, source:string}}
 */
export function readEnvLlmConfig() {
  const e = env()
  const baseUrl = pick(e.VITE_YA_LLM_BASE_URL, e.VITE_OPENAI_BASE_URL, e.VITE_LLM_BASE_URL)
  const model = pick(e.VITE_YA_LLM_MODEL, e.VITE_OPENAI_MODEL, e.VITE_LLM_MODEL)
  const apiKey = pick(e.VITE_YA_LLM_API_KEY, e.VITE_OPENAI_API_KEY, e.VITE_LLM_API_KEY)
  const temperature = pick(e.VITE_YA_LLM_TEMPERATURE, e.VITE_LLM_TEMPERATURE)
  const stream = pick(e.VITE_YA_LLM_STREAM, e.VITE_LLM_STREAM)

  const hasAny = Boolean(baseUrl || model || apiKey)
  const enabled = hasAny ? asBool(pick(e.VITE_YA_LLM_ENABLED, e.VITE_LLM_ENABLED), true) : false

  return {
    enabled,
    baseUrl: String(baseUrl || '').trim(),
    model: String(model || '').trim(),
    apiKey: String(apiKey || '').trim(),
    temperature: temperature === undefined ? 0.3 : Number(temperature),
    stream: stream === undefined ? true : asBool(stream, true),
    source: 'env',
  }
}

/** 环境里是否提供了可用的模型配置 */
export function hasEnvLlmConfig() {
  const c = readEnvLlmConfig()
  return Boolean(c.enabled && c.baseUrl && c.model && c.apiKey)
}
