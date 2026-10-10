/**
 * Yours App (YA) · 本地模拟模型服务（用于验证「前端确实调用了真实的 HTTP 接口」）
 * --------------------------------------------------------------------------
 * 这是一个极简的 OpenAI 兼容服务，实现了 `POST /v1/chat/completions`：
 *   - 支持 stream:true（SSE 逐字返回，含 usage 汇总帧）与 stream:false
 *   - 按对话轮次返回符合 YA 阶段要求的中文回复，并在需要时附带 ```json 的 App Spec
 *   - 记录每个请求（含 system prompt 摘要），便于断言「前端发了什么」
 *
 * 用法：
 *   node scripts/mock-llm-server.mjs           # 监听 http://127.0.0.1:8787
 *   node scripts/mock-llm-server.mjs 9000      # 指定端口
 *
 * 然后把前端配置指向它：
 *   VITE_YA_LLM_BASE_URL=http://127.0.0.1:8787/v1
 *   VITE_YA_LLM_MODEL=mock-ya
 *   VITE_YA_LLM_API_KEY=mock-key
 * 或在 ⚙️ 面板中直接填写同样的地址与 Key。
 *
 * 附带的调试接口（仅供验证脚本使用）：
 *   GET  /_requests  → 返回已收到的请求列表
 *   POST /_reset     → 清空记录
 */

import { createServer } from 'node:http'

const PORT = Number(process.argv[2] || 8787)
const requests = []

/* ----------------------------- 回复内容生成 ----------------------------- */

const FIELD_HINTS = [
  ['工时', 'worklog', '工时记录', [
    ['员工姓名', 'text', true],
    ['所属部门', 'select', true, ['研发部', '市场部', '运营部']],
    ['工作日期', 'date', true],
    ['投入工时(小时)', 'number', true],
    ['工作内容描述', 'textarea', false],
  ]],
  ['库存', 'inventory', '出入库流水', [
    ['物资名称', 'text', true],
    ['出入库类型', 'radio', true, ['入库', '出库']],
    ['数量', 'number', true],
    ['经办人', 'text', true],
  ]],
  ['客户', 'customer', '客户信息', [
    ['客户名称', 'text', true],
    ['联系人', 'text', true],
    ['联系电话', 'phone', true],
    ['跟进记录', 'textarea', false],
  ]],
]

function buildSpec(userText) {
  const hit = FIELD_HINTS.find(([kw]) => userText.includes(kw)) || FIELD_HINTS[0]
  const [, entityId, entityName, fields] = hit
  const toField = ([label, type, required, options], i) => ({
    key: `${entityId}Field${i + 1}`,
    label,
    type,
    required: Boolean(required),
    ...(options ? { options } : {}),
  })
  return {
    appName: `${entityName}助手`,
    icon: '🧪',
    description: `由模拟模型生成：用于记录${entityName}的轻量应用。`,
    featureList: [
      { id: 'feat_1', icon: '📝', title: `${entityName}填报`, description: `录入${entityName}的基础信息` },
      { id: 'feat_2', icon: '📋', title: `${entityName}明细查询`, description: '列表展示与关键词检索' },
      { id: 'feat_3', icon: '📤', title: '数据导出为 CSV', description: '一键导出为表格文件' },
    ],
    entities: [{ entityId, entityName, fields: fields.map(toField) }],
    pages: [
      { pageId: `page_${entityId}_form`, pageTitle: `${entityName}填报`, pageType: 'form', targetEntity: entityId },
      {
        pageId: `page_${entityId}_table`,
        pageTitle: `${entityName}明细查询`,
        pageType: 'table',
        targetEntity: entityId,
        features: ['filter', 'search', 'export_csv', 'delete_row', 'edit_row'],
      },
    ],
  }
}

function buildReply(messages) {
  const history = messages.filter((m) => m.role !== 'system')
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || ''
  // 注意：YA 打开页面时会先推一条「欢迎语」assistant 消息进对话历史，
  // 因此不能用「assistant 消息条数」判断轮次，必须用「用户消息条数」。
  const userTurns = history.filter((m) => m.role === 'user').length
  const spec = buildSpec(lastUser)

  // 第 1 轮：功能清单 + 结构化 Spec
  if (userTurns <= 1) {
    return [
      `收到，你要做的是「${spec.appName}」这类工具。`,
      '',
      '我规划了这些功能：',
      ...spec.featureList.map((f, i) => `${i + 1}. ${f.icon} **${f.title}**：${f.description}`),
      '',
      '需要调整就告诉我；没问题回复「可以，继续」。',
      '',
      '```json',
      JSON.stringify(spec, null, 2),
      '```',
    ].join('\n')
  }

  // 后续轮次：确认调整 + 重新给出最新 Spec（真实模型在迭代时也会这样做）
  return [
    '好的，已按你的要求更新方案，最新规格如下：',
    '',
    ...spec.entities[0].fields.map((f) => `• ${f.label}（${f.type}${f.required ? '，必填' : ''}）`),
    '',
    '确认无误就点击「🚀 确认并生成应用」。',
    '',
    '```json',
    JSON.stringify(spec, null, 2),
    '```',
  ].join('\n')
}

/* -------------------------------- SSE 输出 ------------------------------- */

function sseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',
  })
}

const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`

async function streamReply(res, { model, text }) {
  sseHeaders(res)
  const id = `chatcmpl-mock-${Date.now()}`
  const created = Math.floor(Date.now() / 1000)
  const base = (delta, finish = null) => ({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })

  res.write(frame(base({ role: 'assistant', content: '' })))
  // 按 32 字一块输出，模拟真实流式节奏（步子太碎会明显拖慢自动化验证）
  const chunks = text.match(/[\s\S]{1,32}/g) || []
  for (const piece of chunks) {
    res.write(frame(base({ content: piece })))
    await new Promise((r) => setTimeout(r, 3))
  }
  res.write(frame(base({}, 'stop')))
  // usage 汇总帧（include_usage 时真实服务也会发这一帧）
  res.write(
    frame({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [],
      usage: { prompt_tokens: 320, completion_tokens: Math.ceil(text.length / 2), total_tokens: 320 + Math.ceil(text.length / 2) },
    }),
  )
  res.write('data: [DONE]\n\n')
  res.end()
}

/* --------------------------------- 服务 --------------------------------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 2_000_000) reject(new Error('payload too large'))
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
  })
}

const server = createServer(async (req, res) => {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'GET' && url.pathname === '/_requests') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(requests, null, 2))
    return
  }

  if (req.method === 'POST' && url.pathname === '/_reset') {
    requests.length = 0
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end('{"ok":true}')
    return
  }

  if (req.method !== 'POST' || !/\/chat\/completions$/.test(url.pathname)) {
    res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ error: { message: `unknown endpoint ${req.method} ${url.pathname}` } }))
    return
  }

  let body
  try {
    body = await readBody(req)
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ error: { message: `bad request: ${e.message}` } }))
    return
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  const model = body.model || 'mock-ya'
  const auth = req.headers.authorization || ''
  const system = messages.find((m) => m.role === 'system')?.content || ''
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || ''

  requests.push({
    at: new Date().toISOString(),
    endpoint: url.pathname,
    model,
    stream: Boolean(body.stream),
    hasAuthHeader: Boolean(auth),
    authScheme: auth.split(' ')[0] || '',
    temperature: body.temperature,
    streamOptions: body.stream_options || null,
    messageRoles: messages.map((m) => m.role),
    systemPromptChars: system.length,
    systemHasStageGuide: /当前阶段/.test(system),
    systemHasOutputContract: /结构化输出要求/.test(system),
    lastUser,
  })

  // 故意暴露一个 401 场景，便于验证错误分类
  if (!auth.startsWith('Bearer ') || auth === 'Bearer bad-key') {
    res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ error: { message: 'invalid api key (mock)', type: 'invalid_request_error' } }))
    return
  }

  const text = buildReply(messages)
  // 记录「本次将要返回的原文特征」，便于验证脚本断言返回内容是否正确
  const last = requests[requests.length - 1]
  if (last) {
    last.replyChars = text.length
    last.replyHasJsonFence = text.includes('```json')
    last.replyHead = text.slice(0, 80)
  }
  if (body.stream) {
    await streamReply(res, { model, text })
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
    res.end(
      JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 320, completion_tokens: 64, total_tokens: 384 },
      }),
    )
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-llm] OpenAI 兼容模拟服务已启动：http://127.0.0.1:${PORT}/v1`)
  console.log(`[mock-llm] 请求记录：http://127.0.0.1:${PORT}/_requests`)
})
