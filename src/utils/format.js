/**
 * Yours App (YA) · 通用格式化与导出工具
 */

/** 下载文本文件（浏览器端） */
export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const escapeCsv = (value) => {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** 值 → 可读文本 */
export function displayValue(field, value) {
  if (value === undefined || value === null || value === '') return ''
  switch (field?.type) {
    case 'checkbox':
      return Array.isArray(value) ? value.join('、') : String(value)
    case 'switch':
      return value === true || value === 'true' ? '是' : '否'
    case 'rating':
      return `${'★'.repeat(Number(value) || 0)}${'☆'.repeat(Math.max(0, (field.max ?? 5) - (Number(value) || 0)))}`
    case 'currency':
      return `¥${Number(value).toFixed(2)}`
    case 'number':
      return field?.unit ? `${value}${field.unit}` : String(value)
    case 'datetime': {
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) return String(value)
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    default:
      return String(value)
  }
}

const pad = (n) => String(n).padStart(2, '0')

/**
 * 记录数组 → CSV 文本（含 BOM，Excel 直接打开不乱码）
 * @param {object} entity
 * @param {Array} records
 */
export function recordsToCsv(entity, records = []) {
  const fields = entity?.fields || []
  const header = ['序号', ...fields.map((f) => f.label), '创建时间']
  const lines = [header.map(escapeCsv).join(',')]
  records.forEach((r, i) => {
    const row = [
      i + 1,
      ...fields.map((f) => {
        const v = r.values?.[f.key]
        if (f.type === 'currency' || f.type === 'number' || f.type === 'rating') {
          return v === undefined || v === null || v === '' ? '' : v
        }
        if (f.type === 'switch') return v === true || v === 'true' ? '是' : '否'
        if (Array.isArray(v)) return v.join('、')
        return v ?? ''
      }),
      r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : '',
    ]
    lines.push(row.map(escapeCsv).join(','))
  })
  return `\uFEFF${lines.join('\r\n')}`
}

/** 生成文件名：应用名_实体名_日期.csv */
export function buildCsvFilename(appName, entityName) {
  const d = new Date()
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_')
  return `${safe(appName)}_${safe(entityName)}_${stamp}.csv`
}

/** 相对时间 */
export function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

/** 字节数格式化 */
export function formatBytes(bytes = 0) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 裁剪文本 */
export function truncate(text, len = 40) {
  const s = String(text || '')
  return s.length > len ? `${s.slice(0, len)}…` : s
}
