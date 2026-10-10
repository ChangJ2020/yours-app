import { reactive } from 'vue'

/** 极简全局提示（Toast）状态 */
export const toastState = reactive({ items: [] })

let seq = 0

export function pushToast({ type = 'info', title = '', message = '', duration = 2800 }) {
  const id = ++seq
  toastState.items.push({ id, type, title, message })
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration)
  }
  return id
}

export function dismissToast(id) {
  const idx = toastState.items.findIndex((t) => t.id === id)
  if (idx !== -1) toastState.items.splice(idx, 1)
}

export const toast = {
  info: (message, title = '') => pushToast({ type: 'info', message, title }),
  ok: (message, title = '操作成功') => pushToast({ type: 'ok', message, title }),
  warn: (message, title = '请注意') => pushToast({ type: 'warn', message, title }),
  error: (message, title = '出错了') => pushToast({ type: 'error', title: title || '出错了', message, duration: 4200 }),
}
