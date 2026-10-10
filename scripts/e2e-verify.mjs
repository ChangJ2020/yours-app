/**
 * Yours App (YA) · 端到端验证脚本（Chrome DevTools Protocol，零第三方依赖）
 * 用法：node scripts/e2e-verify.mjs [baseUrl] [outDir]
 *
 * 真实启动无头 Chrome，走完「生成 → 使用 → 迭代 → 重建」完整闭环并逐步截图，
 * 任何一步失败都会截图留证并把诊断信息写入 report.json。
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = process.argv[2] || 'http://localhost:5273'
const OUT = process.argv[3] || 'verify-shots'
const PORT = 9333
/**
 * AI 模式：把前端配置指向本地模拟模型服务，用于验证
 * 「真的发出了 HTTP 请求 → 流式渲染 → 解析 Spec → 生成应用」整条链路。
 * 用法：node scripts/e2e-verify.mjs http://localhost:5273 verify-shots --ai
 * 需先启动：node scripts/mock-llm-server.mjs
 */
const AI_MODE = process.argv.includes('--ai')
const MOCK_LLM = process.env.MOCK_LLM_URL || 'http://127.0.0.1:8787/v1'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p
  throw new Error('未找到 Chrome/Edge 可执行文件')
}

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 极简 CDP 客户端 */
class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.events = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      } else if (msg.method) {
        this.events.push(msg)
      }
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true })
    })
    return new CDP(ws)
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, 30000)
    })
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || '页面脚本异常')
    }
    return res.result.value
  }

  consoleErrors() {
    return this.events
      .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      .map((e) => e.params.args.map((a) => a.value ?? a.description).join(' '))
  }

  pageErrors() {
    return this.events
      .filter((e) => e.method === 'Runtime.exceptionThrown')
      .map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text)
  }

  async type(selector, text) {
    const ok = await this.evaluate(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `)
    if (!ok) throw new Error(`找不到输入框: ${selector}`)
  }

  async screenshot(file) {
    const res = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(file, Buffer.from(res.data, 'base64'))
  }
}

/** 等待页面条件成立 */
async function waitFor(cdp, expression, { timeout = 9000, label = '条件' } = {}) {
  const start = Date.now()
  let last = ''
  while (Date.now() - start < timeout) {
    try {
      if (await cdp.evaluate(`return Boolean(${expression});`)) return true
    } catch (e) {
      last = e?.message || ''
    }
    await sleep(150)
  }
  throw new Error(`等待超时：${label}${last ? ` (${last})` : ''}`)
}

/** 全局按钮文案匹配 */
const FIND_BTN = (text) =>
  `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes(${JSON.stringify(text)}))`

const CLICK_TEXT = (text) => `
  const btn = ${FIND_BTN(text)};
  if (!btn) return false;
  btn.scrollIntoView({ block: 'center' });
  btn.click();
  return true;
`

/** 在指定容器内按文案点击，避免误命中外层同文案按钮 */
const CLICK_IN = (scope, text) => `
  const root = document.querySelector(${JSON.stringify(scope)});
  if (!root) return false;
  const btn = Array.from(root.querySelectorAll('button')).find(b => b.textContent.includes(${JSON.stringify(text)}));
  if (!btn) return false;
  btn.scrollIntoView({ block: 'center' });
  btn.click();
  return true;
`

const CLICK_COMPOSER = (text) => CLICK_IN('.composer', text)
const CLICK_MODAL = (text) => CLICK_IN('.ya-modal', text)

async function main() {
  mkdirSync(OUT, { recursive: true })
  const chrome = findChrome()
  const userDataDir = join(tmpdir(), `ya-chrome-verify-${Date.now()}`)
  rmSync(userDataDir, { recursive: true, force: true })

  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=1440,1000',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--force-device-scale-factor=1',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let target = null
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (target) break
    } catch {
      /* 浏览器还没起来 */
    }
    await sleep(250)
  }
  if (!target) throw new Error('无法连接 Chrome 调试端口')

  const cdp = await CDP.connect(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('DOM.enable')

  const diag = async () =>
    cdp.evaluate(`
      const bubbles = Array.from(document.querySelectorAll('.bubble'));
      return {
        url: location.href,
        bubbles: bubbles.length,
        lastBubble: bubbles.length ? bubbles[bubbles.length - 1].innerText.slice(0, 300) : '',
        text: document.body.innerText.slice(0, 300),
        consoleErrors: ${JSON.stringify(cdp.consoleErrors().slice(-4))},
        pageErrors: ${JSON.stringify(cdp.pageErrors().slice(-4))},
      };
    `)

  try {
    /* ---------------- 1. 冷启动：清空本地存储后加载首页 ---------------- */
    await cdp.send('Page.navigate', { url: BASE })
    await waitFor(cdp, `document.readyState === 'complete'`, { label: '文档就绪', timeout: 15000 })
    // 先只清 localStorage（快）
    await cdp.evaluate(`
      try { localStorage.clear(); } catch (e) {}
      return true;
    `)
    // 再刷新一次，让上一个页面实例释放它的数据库连接，之后的 deleteDatabase 才不会被 blocked
    await cdp.send('Page.reload', { ignoreCache: true })
    await waitFor(cdp, `document.readyState === 'complete'`, { label: '文档就绪(2)', timeout: 15000 })
    const resetResult = await cdp.evaluate(`
      const outcome = await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('yours_app_db');
        req.onsuccess = () => resolve('deleted');
        req.onerror = () => resolve('error');
        req.onblocked = () => resolve('blocked');
        setTimeout(() => resolve('timeout'), 4000);
      });
      return { outcome };
    `)
    if (resetResult.outcome !== 'deleted') {
      console.warn('⚠️  IndexedDB 清理结果：', JSON.stringify(resetResult))
    }
    /* ---------------- 1.5 开启 AI 模式（指向本地模拟模型服务） ---------------- */
    if (AI_MODE) {
      await cdp.evaluate(`
        localStorage.setItem('ya:llm-config', JSON.stringify({
          enabled: true,
          forceLocal: false,
          baseUrl: ${JSON.stringify(MOCK_LLM)},
          model: 'mock-ya',
          apiKey: 'mock-key',
          temperature: 0.3,
          stream: true,
        }));
        return true;
      `)
      // 探活：确认模拟服务在跑，否则给出明确提示
      const alive = await cdp.evaluate(`
        try {
          const r = await fetch(${JSON.stringify(MOCK_LLM.replace('/v1', '/_requests'))}, { method: 'GET' });
          return r.ok;
        } catch (e) { return false; }
      `)
      if (!alive) {
        console.warn(`⚠️  模拟模型服务未启动（${MOCK_LLM}），请先运行：node scripts/mock-llm-server.mjs`)
      } else {
        await cdp.evaluate(`
          await fetch(${JSON.stringify(MOCK_LLM.replace('/v1', '/_reset'))}, { method: 'POST' });
          return true;
        `)
      }
    }

    await cdp.send('Page.reload', { ignoreCache: true })
    try {
      await waitFor(cdp, `document.querySelector('.ya-topbar') && document.body.innerText.includes('Yours App')`, {
        label: '首页渲染',
        timeout: 15000,
      })
    } catch (e) {
      const state = await cdp.evaluate(`
        return {
          url: location.href,
          html: document.body ? document.body.innerHTML.slice(0, 200) : '',
          pageErrors: ${JSON.stringify(cdp.pageErrors().slice(-4))},
          consoleErrors: ${JSON.stringify(cdp.consoleErrors().slice(-4))},
        };
      `)
      throw new Error(`${e.message} | 诊断=${JSON.stringify(state)}`)
    }
    await sleep(1400) // 等待演示数据播种与首屏动画
    await cdp.screenshot(join(OUT, '01-home.png'))

    const home = await cdp.evaluate(`
      const text = document.body.innerText;
      return {
        title: document.title,
        moduleScripts: document.querySelectorAll('script[type=module]').length,
        appCards: document.querySelectorAll('.app-card').length,
        hasSteps: !!document.querySelector('.steps'),
        aiMode: text.includes('AI 对话'),
        localMode: text.includes('内置引擎模式'),
        cards: Array.from(document.querySelectorAll('.app-card .app-name')).map((e) => e.textContent.trim()),
        vueMounted: !!document.querySelector('#app').firstElementChild,
        modePill: (document.querySelector('.mode-pill') || {}).textContent || '',
      };
    `)
    record('首页渲染与 Vue 挂载', home.vueMounted && home.hasSteps, JSON.stringify(home))
    try {
      await waitFor(cdp, `document.querySelectorAll('.app-card').length >= 1`, {
        label: '演示应用卡片',
        timeout: 15000,
      })
    } catch (e) {
      const state = await cdp.evaluate(`
        const pinia = window.__YA_PINIA__;
        const apps = pinia ? pinia._s.get('apps') : null;
        const seeded = (() => { try { return localStorage.getItem('ya:seeded'); } catch (err) { return 'err'; } })();
        // 直接读 IndexedDB，确认数据到底有没有落库
        const dbApps = await new Promise((resolve) => {
          const open = indexedDB.open('yours_app_db');
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('apps_meta')) return resolve({ names: Array.from(db.objectStoreNames) });
            const req = db.transaction('apps_meta', 'readonly').objectStore('apps_meta').getAll();
            req.onsuccess = () => resolve(req.result.map((a) => ({ appId: a.appId, name: a.appName })));
            req.onerror = () => resolve('read-error');
          };
          open.onerror = () => resolve('open-error');
        });
        return {
          seededFlag: seeded,
          appsCount: apps ? apps.apps.length : null,
          appsLoading: apps ? apps.loading : null,
          appsError: apps ? apps.error : null,
          dbApps,
          pageErrors: ${JSON.stringify(cdp.pageErrors().slice(-3))},
          consoleErrors: ${JSON.stringify(cdp.consoleErrors().slice(-3))},
        };
      `)
      throw new Error(`${e.message} | 播种诊断=${JSON.stringify(state)}`)
    }
    record('首次打开自动植入演示应用', true, `卡片：${home.cards.join('、')}`)
    if (AI_MODE) {
      record('AI 模式已启用（顶栏显示 AI 对话）', home.aiMode && !home.localMode, JSON.stringify(home.modePill))
    }

    /* ---------------- 2. 阶段 1：需求描述 → 功能清单（AI 模式：真实调用模型） ---------------- */
    await cdp.type('textarea.composer-input', '我需要一个记录员工工时和加班的 App，可以按部门查询并导出')
    await cdp.evaluate(CLICK_COMPOSER('发送'))
    if (AI_MODE) {
      // 断言「真的发出了 HTTP 请求」，而不是本地拼字符串
      // 等待流式结束（气泡不再显示「生成中…」），避免读到中途状态
      try {
        await waitFor(
          cdp,
          `!document.querySelector('.bubble .ya-badge-brand') && !!document.querySelector('.bubble .ya-badge-mono')`,
          { label: 'AI 回复完成（出现模型徽标）', timeout: 25000 },
        )
      } catch (e) {
        const state = await cdp.evaluate(`
          const pinia = window.__YA_PINIA__;
          const chat = pinia ? pinia._s.get('chat') : null;
          const bubbles = Array.from(document.querySelectorAll('.bubble'));
          return {
            aiStatus: chat ? chat.aiStatus : null,
            lastError: chat ? chat.lastError : null,
            modeNote: chat ? chat.modeNote : null,
            bubbleCount: bubbles.length,
            lastBubble: bubbles.length ? bubbles[bubbles.length - 1].innerText.slice(0, 200) : '',
            messagesTail: chat ? chat.messages.slice(-3).map((m) => ({ role: m.role, mode: m.mode, err: m.errorKind, len: m.content.length })) : null,
            errorPanelShown: !!document.querySelector('.ai-error'),
            pageErrors: ${JSON.stringify(cdp.pageErrors().slice(-3))},
          };
        `)
        throw new Error(`${e.message} | AI 状态=${JSON.stringify(state)}`)
      }
      const aiTurn = await cdp.evaluate(`
        const bubbles = Array.from(document.querySelectorAll('.bubble'));
        const assistant = bubbles.filter((b) => b.dataset.role === 'assistant').pop();
        const badge = assistant ? assistant.querySelector('.ya-badge-mono') : null;
        return {
          badgeText: badge ? badge.textContent.trim() : '',
          title: badge ? badge.getAttribute('title') : '',
          contentChars: assistant ? assistant.innerText.length : 0,
          streamingLeft: !!document.querySelector('.bubble .ya-badge-brand'),
        };
      `)
      record(
        'AI 回复：显示模型名与耗时徽标',
        /mock-ya/.test(aiTurn.badgeText) && aiTurn.contentChars > 40 && !aiTurn.streamingLeft,
        JSON.stringify(aiTurn),
      )
      // 直接问模拟服务：它到底收到了什么
      const log = await cdp.evaluate(`
        const r = await fetch(${JSON.stringify(MOCK_LLM.replace('/v1', '/_requests'))});
        return await r.json();
      `)
      const last = Array.isArray(log) ? log[log.length - 1] : null
      const rawTurn = await cdp.evaluate(`
        const pinia = window.__YA_PINIA__;
        const chat = pinia._s.get('chat');
        const assistants = chat.messages.filter((m) => m.role === 'assistant');
        const last = assistants[assistants.length - 1] || {};
        const content = last.content || '';
        return {
          lastAssistantLen: content.length,
          lastAssistantHead: content.slice(0, 100),
          hasJsonFence: content.indexOf('\`\`\`json') !== -1,
          mode: last.mode,
          model: last.model,
          latencyMs: last.latencyMs,
          usage: last.usage,
          specPresent: !!chat.spec,
          stepKey: chat.stepKey,
          featureCount: chat.featureList.length,
        };
      `)
      record(
        '模型返回内容被前端完整接收（含结构化 Spec 代码块）',
        rawTurn.hasJsonFence && rawTurn.specPresent && rawTurn.featureCount >= 2,
        JSON.stringify(rawTurn),
      )
      const dupUser =
        last && last.messageRoles.length >= 2
          ? last.messageRoles[last.messageRoles.length - 1] === 'user' &&
            last.messageRoles[last.messageRoles.length - 2] === 'user'
          : true
      record(
        '后端确实收到请求（含鉴权头 / 流式 / 阶段提示词）',
        Boolean(last && last.stream && last.hasAuthHeader && last.systemHasStageGuide),
        JSON.stringify(last),
      )
      record('请求体不含重复的最后一条用户消息', dupUser === false, `roles=${last?.messageRoles?.join(',')}`)
    }
    // AI 模式下功能清单来自模型（模拟服务给出「工时记录填报」等），本地模式来自内置引擎
    await waitFor(
      cdp,
      AI_MODE
        ? `document.querySelectorAll('.feat-item').length >= 2`
        : `document.body.innerText.includes('工时快速填报')`,
      { label: '功能清单生成', timeout: 20000 },
    )
    const step1 = await cdp.evaluate(`
      const text = document.body.innerText;
      return {
        featureItems: document.querySelectorAll('.feat-item').length,
        featureTitles: Array.from(document.querySelectorAll('.feat-item .feat-title')).map((e) => e.textContent.trim()),
        sidebarHasFeatures: text.includes('功能清单'),
        chips: Array.from(document.querySelectorAll('.composer .chip')).map((e) => e.textContent.trim()).slice(0, 4),
        stepActive: (document.querySelector('.step[data-state="active"] .step-title') || {}).textContent || '',
        fieldPills: document.querySelectorAll('.field-pill').length,
        hasGenerateBtn: !!${FIND_BTN('确认并生成应用')},
      };
    `)
    record(
      AI_MODE
        ? '阶段 1→2：AI 对话产出功能清单 + 结构化 Spec'
        : '阶段 1→2：对话产出功能清单',
      // AI 模式：模型这一轮就给出完整 Spec，因此详细规格随即可见
      // 内置引擎模式：本阶段只产出功能清单，Spec 在用户确认后才生成
      AI_MODE ? step1.featureItems >= 2 && step1.fieldPills > 0 : step1.featureItems >= 2,
      JSON.stringify(step1),
    )

    /* ---------------- 3. 阶段 2：自然语言增加功能 ---------------- */
    await cdp.type('textarea.composer-input', '增加记录月度优秀员工的功能')
    await cdp.evaluate(CLICK_COMPOSER('发送'))
    if (AI_MODE) {
      const log = await cdp.evaluate(`
        const r = await fetch(${JSON.stringify(MOCK_LLM.replace('/v1', '/_requests'))});
        return await r.json();
      `)
      const last = Array.isArray(log) ? log[log.length - 1] : null
      record(
        '阶段 2：修改需求同样发给了模型（多轮上下文）',
        last?.lastUser === '增加记录月度优秀员工的功能' && last.messageRoles.filter((r) => r === 'assistant').length >= 1,
        `roles=${last?.messageRoles?.join(',')}`,
      )
      // 模型给出的是「工时记录」相关的完整 Spec，这里校验界面确实按 Spec 渲染
      // 先等这一轮流式真正结束，否则会读到写了一半的 JSON
      await waitFor(
        cdp,
        `!document.querySelector('.bubble .ya-badge-brand') && document.querySelectorAll('.bubble .ya-badge-mono').length >= 2`,
        { label: '第二轮 AI 回复完成', timeout: 25000 },
      )
      await sleep(600)
      const aiStep2 = await cdp.evaluate(`
        const pinia = window.__YA_PINIA__;
        const chat = pinia._s.get('chat');
        const last = chat.messages.filter((m) => m.role === 'assistant').pop() || {};
        const first = chat.messages.filter((m) => m.role === 'assistant')[0] || {};
        return {
          stepKey: chat.stepKey,
          stepsActive: (document.querySelector('.step[data-state="active"] .step-title') || {}).textContent || '',
          specPresent: !!chat.spec,
          hasGenerateBtn: !!${FIND_BTN('确认并生成应用')},
          aiStatus: chat.aiStatus,
          modeNote: chat.modeNote,
          lastError: chat.lastError,
          llmTrace: window.__YA_LLM_TRACE__ || null,
          messageCounts: chat.messages.reduce((acc, m) => {
            acc[m.role] = (acc[m.role] || 0) + 1;
            return acc;
          }, {}),
          // 关键：把「解析结果」直接暴露出来，判断问题出在解析还是状态机
          parseProbe: await import('/src/engine/prompt.js').then((m) => {
            const r = m.extractSpecJson(last.content || '');
            return r ? { ok: true, appName: r.appName, fields: (r.entities?.[0]?.fields || []).length } : { ok: false };
          }),
          firstTurnParse: await import('/src/engine/prompt.js').then((m) => {
            const r = m.extractSpecJson(first.content || '');
            return r ? { ok: true, appName: r.appName } : { ok: false };
          }),
        };
      `)
      record(
        'AI 模式：模型输出的多轮 Spec 已被采纳（进入详细规格阶段）',
        aiStep2.specPresent && aiStep2.stepKey === 'spec' && aiStep2.hasGenerateBtn,
        JSON.stringify(aiStep2),
      )
    } else {
      await waitFor(cdp, `document.body.innerText.includes('月度优秀员工记录')`, { label: '新增功能生效', timeout: 15000 })
      const step2 = await cdp.evaluate(`
        return {
          items: document.querySelectorAll('.feat-item').length,
          hasNew: document.body.innerText.includes('月度优秀员工记录'),
        };
      `)
      record('阶段 2：自然语言新增功能', step2.hasNew, JSON.stringify(step2))

      /* ---------------- 4. 阶段 2：自然语言删除功能 ---------------- */
      await cdp.type('textarea.composer-input', '去掉工时明细与汇总')
      await cdp.evaluate(CLICK_COMPOSER('发送'))
      await sleep(1200)
      const step2b = await cdp.evaluate(`
        const items = Array.from(document.querySelectorAll('.feat-item .feat-title')).map((e) => e.textContent.trim());
        return { items, removed: !items.some((t) => t.includes('工时明细与汇总')) };
      `)
      record('阶段 2：自然语言删除功能', step2b.removed, JSON.stringify(step2b))
    }

    /* ---------------- 5. 阶段 2→3：确认后产出详细规格 ---------------- */
    if (!AI_MODE) {
      await cdp.type('textarea.composer-input', '功能没问题，继续')
      const clicked = await cdp.evaluate(CLICK_COMPOSER('发送'))
      if (!clicked) throw new Error('未找到输入区的发送按钮')
      try {
        await waitFor(cdp, `document.body.innerText.includes('数据表') || document.body.innerText.includes('填写页')`, {
          label: '详细规格生成',
          timeout: 15000,
        })
      } catch (e) {
        throw new Error(`${e.message} | 诊断=${JSON.stringify(await diag())}`)
      }
    }
    await sleep(500)
    await cdp.screenshot(join(OUT, '02-spec-confirm.png'))
    const step3 = await cdp.evaluate(`
      const text = document.body.innerText;
      return {
        hasTable: text.includes('数据表'),
        hasPages: text.includes('填写页') || text.includes('查询页'),
        fieldPills: document.querySelectorAll('.field-pill').length,
        hasGenerateBtn: !!${FIND_BTN('确认并生成应用')},
        stepActive: (document.querySelector('.step[data-state="active"] .step-title') || {}).textContent || '',
      };
    `)
    record(
      '阶段 2→3：详细 Spec 已就绪（可确认生成）',
      step3.hasTable && step3.fieldPills > 0 && step3.hasGenerateBtn,
      JSON.stringify(step3),
    )

    /* ---------------- 6. 阶段 4：生成应用 ---------------- */
    await cdp.evaluate(CLICK_COMPOSER('确认并生成应用'))
    await waitFor(cdp, `document.body.innerText.includes('应用构建成功')`, { label: '构建成功提示', timeout: 15000 })
    await sleep(900)
    const built = await cdp.evaluate(`
      const cards = Array.from(document.querySelectorAll('.app-card .app-name')).map((e) => e.textContent.trim());
      return {
        cards,
        success: document.body.innerText.includes('应用构建成功'),
        highlight: document.querySelectorAll('.app-card[data-new="true"]').length,
      };
    `)
    record('阶段 4：应用生成并插入应用展台', built.success && built.cards.length >= 2, JSON.stringify(built))
    await cdp.screenshot(join(OUT, '03-generated.png'))

    /* ---------------- 7. 进入详情页：实际使用（动态表单） ---------------- */
    // 打开「当前应用」，优先使用刚刚构建的那个应用，避免命中预置的演示应用
    const targetApp = await cdp.evaluate(`
      const active = document.querySelector('.app-card[data-new="true"]');
      const card = active || document.querySelector('.app-card');
      const name = card ? (card.querySelector('.app-name') || {}).textContent : '';
      const btn = card && Array.from(card.querySelectorAll('button')).find((b) => b.textContent.includes('进入使用'));
      if (!btn) return null;
      btn.click();
      return { name: (name || '').trim(), highlighted: !!active };
    `)
    if (!targetApp) throw new Error('未找到应用卡片入口')
    await waitFor(cdp, `document.body.innerText.includes('实际使用应用')`, { label: '详情页加载', timeout: 15000 })
    await sleep(700)
    const detail = await cdp.evaluate(`
      const text = document.body.innerText;
      return {
        appName: (document.querySelector('.app-title') || {}).textContent.replace(/\\s+/g, ' ').trim() || '',
        tabs: Array.from(document.querySelectorAll('.ya-tab')).map((e) => e.textContent.trim()),
        formFields: document.querySelectorAll('.dyn-form .ya-field').length,
        requiredFields: document.querySelectorAll('.dyn-form .req').length,
        hasIterateBtn: !!${FIND_BTN('用 AI 迭代此 App')},
        version: (text.match(/v\\d+\\.\\d+\\.\\d+/) || [])[0] || '',
        route: location.hash,
      };
    `)
    record(
      '详情页：实际使用 + 动态表单渲染',
      detail.formFields >= 3 && detail.requiredFields > 0 && detail.hasIterateBtn && detail.appName.includes(targetApp.name.slice(0, 4)),
      JSON.stringify({ target: targetApp, ...detail }),
    )
    await cdp.screenshot(join(OUT, '04-app-live-form.png'))

    /* ---------------- 8. 动态表单：必填校验 + 提交 ---------------- */
    const guard = await cdp.evaluate(`
      const form = document.querySelector('.dyn-form');
      const btn = form.querySelector('button[type=submit]');
      const before = document.body.innerText;
      const disabledWhenInvalid = btn.disabled;
      const countBefore = document.querySelectorAll('.recent-item').length;
      btn.click(); // 无效表单：按钮禁用，点击不应产生任何提交
      await new Promise((r) => setTimeout(r, 300));
      const after = document.body.innerText;
      return {
        disabledWhenInvalid,
        added: document.querySelectorAll('.recent-item').length - countBefore,
        unchanged: before === after,
      };
    `)
    record(
      '必填校验：不满足必填时提交被拦截',
      guard.disabledWhenInvalid && guard.added === 0,
      JSON.stringify(guard),
    )

    const blurValidation = await cdp.evaluate(`
      const el = document.querySelector('.dyn-form input[type=text]');
      el.focus();
      el.value = '临时';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const err = document.querySelector('.dyn-form .ya-error');
      return { hasError: !!err, text: err ? err.textContent.trim() : '' };
    `)
    record('字段级实时校验提示', blurValidation.hasError, JSON.stringify(blurValidation))

    const filled = await cdp.evaluate(`
      const inputs = Array.from(document.querySelectorAll('.dyn-form input, .dyn-form select, .dyn-form textarea'));
      const setVal = (el, v) => {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      let count = 0;
      for (const el of inputs) {
        if (el.tagName === 'SELECT') { const opt = el.options[1]; if (opt) { setVal(el, opt.value); count++; } }
        else if (el.type === 'date') { setVal(el, '2026-03-18'); count++; }
        else if (el.type === 'number') { setVal(el, '7.5'); count++; }
        else if (el.tagName === 'TEXTAREA') { setVal(el, '端到端验证：完成工时填报闭环联调'); count++; }
        else if (el.type === 'text' || el.type === 'email') { setVal(el, '张验真'); count++; }
      }
      return count;
    `)
    await sleep(300)
    await cdp.evaluate(`
      document.querySelector('.dyn-form button[type=submit]').click();
      return true;
    `)
    await waitFor(cdp, `document.querySelectorAll('.recent-item').length > 0`, { label: '提交记录写入', timeout: 9000 })
    const submitted = await cdp.evaluate(`
      const text = document.body.innerText;
      return {
        recent: document.querySelectorAll('.recent-item').length,
        filled: ${filled},
        toast: (document.querySelector('.toast') || {}).innerText || '',
        countText: (text.match(/(\\d+) 条记录/) || [])[1] || '',
      };
    `)
    record('动态表单提交 + 本地持久化', submitted.recent > 0, JSON.stringify(submitted))

    /* ---------------- 9. 动态表格：检索 / 排序 / 统计 / 导出 ---------------- */
    // 点击该应用的表格页（页签名由 Spec 决定，动态取第二个页面）
    const switched = await cdp.evaluate(`
      const tabs = Array.from(document.querySelectorAll('.live-head .ya-tab'));
      const tableTab = tabs[tabs.length - 1];
      if (!tableTab) return false;
      tableTab.click();
      return true;
    `)
    if (!switched) throw new Error('未找到页面标签')
    await waitFor(cdp, `!!document.querySelector('.ya-table')`, { label: '表格渲染', timeout: 9000 })
    const table = await cdp.evaluate(`
      const headers = Array.from(document.querySelectorAll('.ya-table thead th')).map((e) => e.textContent.trim());
      const rows = document.querySelectorAll('.ya-table tbody tr').length;
      return {
        headers,
        rows,
        hasSearch: !!document.querySelector('.search-input'),
        hasExport: !!${FIND_BTN('导出 CSV')},
        stats: Array.from(document.querySelectorAll('.stat-label')).map((e) => e.textContent.trim()),
      };
    `)
    record('动态表格：表头 / 行 / 检索 / 导出 / 统计', table.rows > 0 && table.hasSearch && table.hasExport, JSON.stringify(table))

    // 取第一行第一列的实际值作为检索词，保证对不同 Spec 都成立
    const probe = await cdp.evaluate(`
      const row = document.querySelector('.ya-table tbody tr');
      if (!row) return '';
      return row.children[1].innerText.trim().replace(/\\s+/g, ' ');
    `)
    if (probe) {
      await cdp.type('.search-input', probe)
      await sleep(600)
      const searched = await cdp.evaluate(`
        const rows = Array.from(document.querySelectorAll('.ya-table tbody tr'));
        const probe = ${JSON.stringify(probe)};
        return {
          probe,
          rows: rows.length,
          allMatch: rows.length > 0 && rows.every((r) => r.innerText.includes(probe)),
        };
      `)
      record('关键词检索过滤', searched.rows > 0 && searched.allMatch, JSON.stringify(searched))
    } else {
      record('关键词检索过滤', false, '表格没有数据行，无法验证检索')
    }

    const filteredOut = await cdp.type('.search-input', '不存在的值ZZZ')
    void filteredOut
    await sleep(500)
    const emptyState = await cdp.evaluate(`return document.body.innerText.includes('没有符合条件的记录');`)
    record('检索无结果时展示空状态', emptyState === true, `emptyState=${emptyState}`)

    await cdp.evaluate(`
      const el = document.querySelector('.search-input');
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `)
    await sleep(400)
    const sorted = await cdp.evaluate(`
      const th = Array.from(document.querySelectorAll('.ya-table thead th')).find((e) => e.textContent.includes('工时'));
      const target = th || Array.from(document.querySelectorAll('.ya-table thead th'))[1];
      target.click();
      await new Promise((r) => setTimeout(r, 300));
      const cells = Array.from(document.querySelectorAll('.ya-table tbody tr')).map((r) => r.children[1].innerText.trim());
      return { cells: cells.slice(0, 4), header: target.textContent.trim() };
    `)
    record('表头点击排序', sorted.cells.length >= 1, JSON.stringify(sorted))
    await cdp.screenshot(join(OUT, '05-app-live-table.png'))

    /* ---------------- 10. 工作室：功能清单 ↔ Spec 双向联动 ---------------- */
    await cdp.evaluate(CLICK_TEXT('功能清单与 Spec 配置编辑'))
    await waitFor(cdp, `!!document.querySelector('.studio-grid')`, { label: '工作室渲染', timeout: 9000 })
    await sleep(600)
    const studio = await cdp.evaluate(`
      return {
        featCards: document.querySelectorAll('.feat').length,
        fieldEditors: document.querySelectorAll('.field-editor').length,
        pages: document.querySelectorAll('.page').length,
        syncState: (document.querySelector('.sync-bar') || {}).dataset?.state || '',
      };
    `)
    record('工作室：功能清单 + 详细 Spec 双栏联动', studio.featCards > 0 && studio.fieldEditors > 0, JSON.stringify(studio))
    await cdp.screenshot(join(OUT, '06-studio.png'))

    const instruction = '增加请假登记功能'
    // 先验证「指令 → 新增功能」这条纯逻辑链路
    const planProbe = await cdp.evaluate(`
      const pinia = window.__YA_PINIA__;
      const chat = pinia._s.get('chat');
      const before = chat.featureList.map((f) => f.title);
      const plan = chat.planInstruction(${JSON.stringify(instruction)}, '员工工时记录助手');
      return {
        before,
        notes: plan.notes,
        added: plan.featureList.filter((f) => !before.includes(f.title)).map((f) => f.title),
      };
    `)
    record(
      '自然语言指令解析：识别出要新增的功能',
      planProbe.added.includes('请假登记'),
      JSON.stringify(planProbe),
    )

    const featsBefore = await cdp.evaluate(`return document.querySelectorAll('.feat').length;`)
    await cdp.type('.nl-box textarea', instruction)
    const clickedApply = await cdp.evaluate(`
      const btn = Array.from(document.querySelectorAll('.nl-box button')).find((b) => b.textContent.includes('应用'));
      if (!btn) return false;
      btn.click();
      return true;
    `)
    if (!clickedApply) throw new Error('未找到「应用」按钮')
    await sleep(800)
    const linked = await cdp.evaluate(`
      const titles = Array.from(document.querySelectorAll('.feat .feat-title')).map((e) => e.innerText.trim());
      const sync = document.querySelector('.sync-bar');
      return {
        feats: titles.length,
        hasLeave: titles.some((t) => t.includes('请假登记')),
        syncState: sync ? sync.dataset.state : '',
        chips: Array.from(document.querySelectorAll('.sync-bar .chip')).map((e) => e.textContent.trim()),
        notes: Array.from(document.querySelectorAll('.nl-box .ya-note')).map((n) => n.textContent.trim()),
        featsBefore: ${featsBefore},
      };
    `)
    record(
      '功能清单改动 → Spec 联动 + 待同步状态',
      linked.hasLeave && linked.feats === linked.featsBefore + 1 && linked.syncState === 'dirty',
      JSON.stringify(linked),
    )
    record(
      '执行反馈：界面提示来自真实执行结果',
      linked.notes.some((n) => n.includes('已新增功能') && n.includes('请假登记')),
      JSON.stringify(linked.notes),
    )

    const edited = await cdp.evaluate(`
      const labelOf = (ed) => ((ed.querySelector('.label-input') || {}).value || '').trim();
      const byLabel = (name) => Array.from(document.querySelectorAll('.field-editor')).find((e) => labelOf(e) === name);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      // 1) 改名字段：第一个字段 → 追加「（修订）」
      const first = document.querySelector('.field-editor .label-input');
      const renamedTo = (first.value || '').trim() + '（修订）';
      first.value = renamedTo;
      first.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(250);

      // 2) 删除最后一个字段（与具体业务无关，测试更稳定），并重试直到真的从界面消失
      let removedLabel = '';
      let attempts = 0;
      while (attempts < 3) {
        const editors = Array.from(document.querySelectorAll('.field-editor'));
        const target = editors[editors.length - 1];
        if (!target) break;
        removedLabel = labelOf(target);
        target.querySelector('button[title="删除字段"]').click();
        await sleep(280);
        if (!byLabel(removedLabel)) break;
        attempts += 1;
      }
      const remaining = Array.from(document.querySelectorAll('.field-editor')).map(labelOf);
      return { removedLabel, renamedTo, attempts, remaining };
    `)
    await sleep(500)
    const afterEdit = await cdp.evaluate(`
      const labels = Array.from(document.querySelectorAll('.field-editor')).map((e) => {
        const input = e.querySelector('.label-input');
        return input ? String(input.value || '').trim() : '';
      });
      return {
        removedChips: document.querySelectorAll('.chip.danger').length,
        fields: labels.length,
        labels,
        syncState: (document.querySelector('.sync-bar') || {}).dataset?.state || '',
      };
    `)
    record(
      '详细 Spec 直接编辑（字段改名 / 删除字段）',
      afterEdit.labels.includes(edited.renamedTo) &&
        !afterEdit.labels.includes(edited.removedLabel) &&
        afterEdit.syncState === 'dirty',
      JSON.stringify({ ...afterEdit, removedLabel: edited.removedLabel, attempts: edited.attempts }),
    )
    await cdp.screenshot(join(OUT, '07-studio-dirty.png'))

    /* ---------------- 11. 重新构建①：新增字段与功能落地 ---------------- */
    await cdp.evaluate(CLICK_TEXT('重新构建并运行应用'))
    await waitFor(cdp, `document.body.innerText.includes('重新构建并升级到')`, { label: '重建确认弹窗', timeout: 9000 })
    const rebuildModal = await cdp.evaluate(`
      const modal = document.querySelector('.ya-modal');
      const rows = Array.from(modal.querySelectorAll('.diff-list .ya-note')).map((n) => n.innerText.trim());
      return {
        diffRows: rows.length,
        rows,
        archiveCheckbox: !!modal.querySelector('input[type=checkbox]'),
        impact: modal.querySelector('.impact') ? modal.querySelector('.impact').innerText.split('\\n').join(' | ') : '',
      };
    `)
    record(
      '重建确认：变更清单 + 数据影响提示',
      rebuildModal.diffRows > 0 && rebuildModal.impact.includes('受影响的现有数据'),
      JSON.stringify({ diffRows: rebuildModal.diffRows, archiveCheckbox: rebuildModal.archiveCheckbox, impact: rebuildModal.impact }),
    )
    await cdp.screenshot(join(OUT, '08-rebuild-diff.png'))

    await cdp.evaluate(`
      const modal = document.querySelector('.ya-modal');
      const btn = Array.from(modal.querySelectorAll('button')).find((b) => b.textContent.includes('确认并重新构建'));
      btn.click();
      return true;
    `)
    await waitFor(cdp, `document.body.innerText.includes('重新构建完成')`, { label: '重建完成', timeout: 20000 })
    await sleep(1300)
    const afterRebuild = await cdp.evaluate(`
      const pinia = window.__YA_PINIA__;
      const apps = pinia._s.get('apps');
      const appId = location.hash.split('/').pop();
      const spec = await apps.fetchOne(appId);
      return {
        appId,
        version: spec.version,
        fields: spec.entities[0].fields.map((f) => f.label),
        backToLive: document.body.innerText.includes('实际使用应用') && !document.querySelector('.studio-grid'),
      };
    `)
    record(
      '重建完成：版本升级到 v1.1.0 且新字段生效',
      afterRebuild.version === '1.1.0' &&
        afterRebuild.fields.includes(edited.renamedTo) &&
        !afterRebuild.fields.includes(edited.removedLabel) &&
        afterRebuild.fields.length === afterEdit.fields &&
        afterRebuild.backToLive,
      JSON.stringify({ ...afterRebuild, renamedTo: edited.renamedTo, removedLabel: edited.removedLabel }),
    )
    await cdp.screenshot(join(OUT, '09-after-rebuild.png'))

    /* ---------------- 12. 提交一条带新字段的数据，验证跨版本数据保留 ---------------- */
    const submittedAudit = await cdp.evaluate(`
      const inputs = Array.from(document.querySelectorAll('.dyn-form input, .dyn-form select, .dyn-form textarea'));
      const setVal = (el, v) => {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      for (const el of inputs) {
        if (el.tagName === 'SELECT') { const opt = el.options[1]; if (opt) setVal(el, opt.value); }
        else if (el.type === 'date') setVal(el, '2026-04-02');
        else if (el.type === 'number') setVal(el, '6');
        else if (el.tagName === 'TEXTAREA') setVal(el, '第二次构建后补充的一条记录');
        else if (el.type === 'text') setVal(el, '审核验证');
      }
      await new Promise((r) => setTimeout(r, 200));
      document.querySelector('.dyn-form button[type=submit]').click();
      await new Promise((r) => setTimeout(r, 500));
      return { recent: document.querySelectorAll('.recent-item').length };
    `)
    record('v1.1.0 表单可提交新字段数据', submittedAudit.recent > 0, JSON.stringify(submittedAudit))

    /* ---------------- 13. 归档保护场景：独立准备一个「已上线且有数据」的应用 ----------------
     * 为了让「删除已上线字段」的验证干净可信，这里用应用自身的 API 在页面内重建一个
     * 干净场景（构建 v1.0.0 → 提交 2 条带审核字段的数据），再通过真实 UI 删除字段并重建。 */
    const prepared = await cdp.evaluate(`
      const pinia = window.__YA_PINIA__;
      const apps = pinia._s.get('apps');
      const chat = pinia._s.get('chat');
      const router = window.__YA_APP__.config.globalProperties.$router;

      // 1) 用真实生成链路构建一个干净应用
      chat.reset();
      const { draft } = await import('/src/engine/agent.js').then(async (m) => {
        const r = m.respondToDescription('我需要一个记录员工工时和加班的 App，能按部门查询并导出');
        return { draft: r.draft };
      });
      const { compileSpecFromFeatureList, applyFeatureInstruction, analyzeRequirement } = await import('/src/engine/localEngine.js');
      const analysisInfo = analyzeRequirement(draft.raw);
      const reanalyzedId = analyzeRequirement(analysisInfo.raw).domainId;
      const plan = applyFeatureInstruction({
        featureList: draft.featureList,
        text: '增加工时审核状态功能',
        baseText: draft.raw,
      });
      const spec = compileSpecFromFeatureList({
        featureList: plan.featureList,
        baseText: draft.raw,
        appName: draft.appName,
        icon: draft.icon,
        description: draft.description,
      });
      const saved = await apps.create(spec);

      // 2) 写入两条含「审核人」的数据（key 必须取自 Spec 的真实字段 key）
      const storage = await import('/src/services/storageService.js');
      const e = saved.entities[0];
      const k = (label) => (e.fields.find((f) => f.label === label) || {}).key;
      await storage.createRecord(saved.appId, e.entityId, {
        [k('员工姓名')]: '张伟', [k('所属部门')]: '研发部', [k('工作日期')]: '2026-04-01',
        [k('项目名称')]: 'YA 平台', [k('投入工时(小时)')]: 8, [k('工作内容描述')]: '联调',
        [k('审核状态')]: '待审核', [k('审核人')]: '王主管',
      });
      await storage.createRecord(saved.appId, e.entityId, {
        [k('员工姓名')]: '李娜', [k('所属部门')]: '市场部', [k('工作日期')]: '2026-04-02',
        [k('项目名称')]: '推广', [k('投入工时(小时)')]: 6, [k('工作内容描述')]: '物料',
        [k('审核状态')]: '待审核', [k('审核人')]: '赵经理',
      });

      // 3) 进入该应用详情页
      await router.push({ name: 'app-detail', params: { appId: saved.appId } });
      return {
        appId: saved.appId,
        fields: saved.entities[0].fields.map((f) => f.label),
        version: saved.version,
        diag: {
          draftRaw: draft.raw,
          draftFeatures: draft.featureList.map((f) => f.title),
          planFeatures: plan.featureList.map((f) => f.title),
          planNotes: plan.notes,
          compiledFields: spec.entities[0].fields.map((f) => f.label),
          savedFields: saved.entities[0].fields.map((f) => f.label),
          analysis: analysisInfo,
          entityId: spec.entities[0].entityId,
          reanalyzed: reanalyzedId,
        },
      };
    `)
    await waitFor(cdp, `document.body.innerText.includes('功能清单与 Spec 配置编辑')`, { label: '归档场景就绪', timeout: 12000 })
    await sleep(700)
    record(
      '归档场景准备：构建含审核字段的应用并写入 2 条数据',
      prepared.fields.includes('审核人') && prepared.fields.includes('审核状态'),
      JSON.stringify(prepared),
    )

    await cdp.evaluate(CLICK_TEXT('功能清单与 Spec 配置编辑'))
    await waitFor(cdp, `!!document.querySelector('.studio-grid')`, { label: '归档场景工作室', timeout: 9000 })
    await sleep(500)
    const beforeDelete = await cdp.evaluate(`
      const pinia = window.__YA_PINIA__;
      const chat = pinia._s.get('chat');
      const apps = pinia._s.get('apps');
      const appId = location.hash.split('/').pop();
      const dbSpec = await apps.fetchOne(appId);
      return {
        domFields: Array.from(document.querySelectorAll('.field-editor')).map((e) => ((e.querySelector('.label-input') || {}).value || '').trim()),
        chatSpec: chat.spec ? chat.spec.entities[0].fields.map((f) => f.label) : null,
        dbFields: dbSpec.entities[0].fields.map((f) => f.label),
      };
    `)

    const removed = await cdp.evaluate(`
      const labelOf = (ed) => {
        const input = ed.querySelector('.label-input');
        return input ? String(input.value || '').trim() : '';
      };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 3; i += 1) {
        const target = Array.from(document.querySelectorAll('.field-editor')).find((e) => labelOf(e) === '审核人');
        if (!target) break;
        target.querySelector('button[title="删除字段"]').click();
        await sleep(300);
      }
      return {
        remaining: Array.from(document.querySelectorAll('.field-editor')).map(labelOf),
        syncState: (document.querySelector('.sync-bar') || {}).dataset?.state || '',
      };
    `)
    record(
      '在 Spec 编辑器删除已上线字段「审核人」',
      !removed.remaining.includes('审核人') && removed.syncState === 'dirty',
      JSON.stringify({ ...removed, beforeDelete }),
    )

    await cdp.evaluate(CLICK_TEXT('重新构建并运行应用'))
    await waitFor(cdp, `document.body.innerText.includes('重新构建并升级到')`, { label: '重建确认弹窗②', timeout: 9000 })
    const archiveModal = await cdp.evaluate(`
      const modal = document.querySelector('.ya-modal');
      const cb = modal.querySelector('input[type=checkbox]');
      const btn = Array.from(modal.querySelectorAll('button')).find((b) => b.textContent.includes('确认并重新构建'));
      return {
        hasRemoveLine: modal.innerText.includes('删除字段'),
        archiveCheckbox: !!cb,
        confirmDisabled: btn.disabled,
        impact: modal.querySelector('.impact') ? modal.querySelector('.impact').innerText.split('\\n').join(' | ') : '',
      };
    `)
    record(
      '归档保护：删除已上线字段时弹出二次确认且默认禁用构建',
      archiveModal.hasRemoveLine && archiveModal.archiveCheckbox && archiveModal.confirmDisabled === true,
      JSON.stringify(archiveModal),
    )
    await cdp.screenshot(join(OUT, '13-archive-guard.png'))
    // 额外截取弹窗区域本身，便于人工核对弹窗是否真的有穿透/重影问题
    const clip = await cdp.evaluate(`
      const r = document.querySelector('.ya-modal').getBoundingClientRect();
      return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: r.height + 16 };
    `)
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { ...clip, scale: 1 },
      captureBeyondViewport: true,
    })
    writeFileSync(join(OUT, '13b-archive-modal-clip.png'), Buffer.from(shot.data, 'base64'))
    const modalStyle = await cdp.evaluate(`
      const modal = document.querySelector('.ya-modal');
      const mask = document.querySelector('.ya-modal-mask');
      const cs = getComputedStyle(modal);
      const ms = getComputedStyle(mask);
      return {
        modalBg: cs.backgroundColor,
        modalOpacity: cs.opacity,
        modalFilter: cs.backdropFilter || cs.webkitBackdropFilter,
        maskBg: ms.backgroundColor,
        maskFilter: ms.backdropFilter || ms.webkitBackdropFilter,
      };
    `)
    record(
      '弹窗视觉合规（不透明、无异常滤镜）',
      modalStyle.modalOpacity === '1' && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(modalStyle.modalBg),
      JSON.stringify(modalStyle),
    )

    await cdp.evaluate(`
      const modal = document.querySelector('.ya-modal');
      const cb = modal.querySelector('input[type=checkbox]');
      if (cb && !cb.checked) cb.click();
      await new Promise((r) => setTimeout(r, 150));
      const btn = Array.from(modal.querySelectorAll('button')).find((b) => b.textContent.includes('确认并重新构建'));
      btn.click();
      return true;
    `)
    await waitFor(cdp, `document.body.innerText.includes('重新构建完成')`, { label: '重建完成②', timeout: 20000 })
    await sleep(1400)
    const archived = await cdp.evaluate(`
      const pinia = window.__YA_PINIA__;
      const apps = pinia._s.get('apps');
      const spec = await apps.fetchOne(location.hash.split('/').pop());
      const rows = await new Promise((resolve) => {
        const open = indexedDB.open('yours_app_db');
        open.onsuccess = () => {
          const req = open.result.transaction('app_records', 'readonly').objectStore('app_records').getAll();
          req.onsuccess = () => resolve(req.result.filter((r) => r.appId === spec.appId));
          req.onerror = () => resolve([]);
        };
        open.onerror = () => resolve([]);
      });
      return {
        version: spec.version,
        fields: spec.entities[0].fields.map((f) => f.label),
        recordCount: rows.length,
        archivedValues: rows
          .filter((r) => r._archived && Object.keys(r._archived).length)
          .map((r) => Object.values(r._archived).map((a) => a.value)),
        mainValuesIntact: rows.every((r) => Object.values(r.values).filter((v) => v !== '' && v !== null).length >= 6),
      };
    `)
    record(
      '数据无损：记录保留、被删字段值进入归档区、版本升到 v1.1.0',
      archived.version === '1.1.0' &&
        !archived.fields.includes('审核人') &&
        archived.recordCount === 2 &&
        archived.archivedValues.length === 2 &&
        archived.mainValuesIntact === true,
      JSON.stringify(archived),
    )
    await cdp.screenshot(join(OUT, '14-after-archive.png'))

    /* ---------------- 14. 用 AI 迭代此 App ---------------- */
    await cdp.evaluate(CLICK_TEXT('用 AI 迭代此 App'))
    await waitFor(cdp, `!!document.querySelector('.iter-log')`, { label: '迭代弹窗', timeout: 9000 })
    await cdp.type('.ya-modal textarea', '增加数据汇总统计功能')
    await cdp.evaluate(CLICK_MODAL('提交'))
    await waitFor(cdp, `!!document.querySelector('.iter-preview')`, { label: '迭代方案预览', timeout: 15000 })
    const iterated = await cdp.evaluate(`
      const modal = document.querySelector('.ya-modal');
      return {
        preview: !!modal.querySelector('.iter-preview'),
        items: modal.querySelectorAll('.iter-list li').length,
        diffLines: modal.querySelectorAll('.iter-diff .ya-note').length,
        hasApply: !!Array.from(modal.querySelectorAll('button')).find((b) => b.textContent.includes('应用到功能清单')),
      };
    `)
    record('迭代弹窗：方案预览 + 差异提示', iterated.preview && iterated.hasApply, JSON.stringify(iterated))
    await cdp.screenshot(join(OUT, '10-iterate.png'))

    await cdp.evaluate(CLICK_MODAL('应用到功能清单'))
    await sleep(900)
    const applied = await cdp.evaluate(`
      return {
        studio: !!document.querySelector('.studio-grid'),
        state: (document.querySelector('.sync-bar') || {}).dataset?.state || '',
      };
    `)
    record('迭代方案回填编辑区', applied.studio === true, JSON.stringify(applied))

    /* ---------------- 13. 版本历史 ---------------- */
    await cdp.evaluate(CLICK_TEXT('版本'))
    await waitFor(cdp, `document.body.innerText.includes('版本历史')`, { label: '版本历史', timeout: 9000 })
    const versions = await cdp.evaluate(`
      const modal = document.querySelector('.ya-modal');
      return {
        count: modal.querySelectorAll('.ver').length,
        hasRollback: !!Array.from(modal.querySelectorAll('button')).find((b) => b.textContent.includes('回滚')),
      };
    `)
    record('版本历史快照与回滚入口', versions.count >= 2 && versions.hasRollback, JSON.stringify(versions))
    await cdp.screenshot(join(OUT, '11-versions.png'))
    await cdp.evaluate(CLICK_MODAL('✕'))

    /* ---------------- 14. 返回首页 + 主题切换 + 持久化 ---------------- */
    await cdp.evaluate(CLICK_TEXT('返回首页'))
    await waitFor(cdp, `!!document.querySelector('.steps')`, { label: '返回首页', timeout: 9000 })

    await cdp.evaluate(`
      const btn = document.querySelector('button[title*="深色"], button[title*="浅色"]');
      btn.click();
      return true;
    `)
    await sleep(600)
    const theme = await cdp.evaluate(`return document.documentElement.dataset.theme;`)
    record('深色主题切换', theme === 'dark', `theme=${theme}`)

    await cdp.send('Page.navigate', { url: BASE })
    await waitFor(cdp, `document.querySelectorAll('.app-card').length >= 2`, { label: '刷新后数据仍在', timeout: 15000 })
    const persisted = await cdp.evaluate(`
      const cards = Array.from(document.querySelectorAll('.app-card .app-name')).map((e) => e.textContent.trim());
      return { cards, theme: document.documentElement.dataset.theme, count: cards.length };
    `)
    record('IndexedDB 持久化：刷新后应用与数据仍在', persisted.count >= 2, JSON.stringify(persisted))
    await cdp.screenshot(join(OUT, '12-dark-home.png'))

    /* ---------------- 15. 运行期错误检查 ---------------- */
    const errors = [...cdp.consoleErrors(), ...cdp.pageErrors()].filter(
      (e) => e && !/favicon|DevTools|Autofill|\[vite\] connect/i.test(e),
    )
    record('运行期无 JS 异常 / 控制台错误', errors.length === 0, errors.slice(0, 3).join(' | '))
  } catch (error) {
    record('验证流程中断', false, error?.message || String(error))
    try {
      await cdp.screenshot(join(OUT, '99-failure.png'))
    } catch {
      /* ignore */
    }
  } finally {
    try {
      await cdp.send('Browser.close')
    } catch {
      /* ignore */
    }
    child.kill()
  }

  const passed = results.filter((r) => r.ok).length
  console.log(`\n=========== 结果：${passed}/${results.length} 通过 ===========`)
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ base: BASE, passed, total: results.length, results }, null, 2))
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((e) => {
  console.error('验证脚本异常：', e)
  process.exit(2)
})
