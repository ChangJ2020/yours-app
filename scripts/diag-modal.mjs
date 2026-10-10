/**
 * 排查：弹窗出现「穿透/重影」到底是 CSS 问题还是无头截图的 backdrop-filter 伪影
 * 用法：node scripts/diag-modal.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5273'
const OUT = 'verify-shots'
const PORT = 9335
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p))

mkdirSync(OUT, { recursive: true })
const userDataDir = join(tmpdir(), `ya-diag-${Date.now()}`)
rmSync(userDataDir, { recursive: true, force: true })

const child = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, '--window-size=1440,1000', '--no-first-run', 'about:blank'],
  { stdio: 'ignore' },
)

let target = null
for (let i = 0; i < 60; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    if (target) break
  } catch {}
  await sleep(250)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result)
    pending.delete(m.id)
  }
})
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })
  return r.result?.value
}
const shoot = async (file, opts = {}) => {
  const r = await send('Page.captureScreenshot', { format: 'png', ...opts })
  writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: BASE })
for (let i = 0; i < 60; i += 1) {
  if (await evaluate(`return !!document.querySelector('.ya-topbar');`)) break
  await sleep(200)
}
await sleep(1500)

// 打开帮助弹窗（内容多的那个）
await evaluate(`
  const btn = document.querySelector('button[title="使用指南"]');
  btn.click();
  return true;
`)
await sleep(900)

const probe = await evaluate(`
  const modal = document.querySelector('.ya-modal');
  const mask = document.querySelector('.ya-modal-mask');
  const cs = getComputedStyle(modal);
  return {
    modalBg: cs.backgroundColor,
    modalOpacity: cs.opacity,
    modalTransform: cs.transform,
    modalAnimation: cs.animationName,
    maskBg: getComputedStyle(mask).backgroundColor,
    maskFilter: getComputedStyle(mask).backdropFilter,
    rootTheme: document.documentElement.dataset.theme,
    tokenBgElevated: getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated'),
  };
`)
console.log('弹窗样式探针 =', JSON.stringify(probe, null, 2))

await shoot('diag-01-modal-backdrop.png')
await shoot('diag-02-modal-clip.png', { clip: await evaluate(`
  const r = document.querySelector('.ya-modal').getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 };
`) })

// 去掉 backdrop-filter 后再截一次，用于判断伪影来源
await evaluate(`
  const s = document.createElement('style');
  s.textContent = '.ya-modal-mask{backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}';
  document.head.appendChild(s);
  return true;
`)
await sleep(400)
await shoot('diag-03-modal-noblur.png')
await shoot('diag-04-modal-noblur-clip.png', { clip: await evaluate(`
  const r = document.querySelector('.ya-modal').getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 };
`) })

await send('Browser.close')
child.kill()
console.log('已输出：diag-01/02（含模糊）、diag-03/04（去模糊）到', OUT)
