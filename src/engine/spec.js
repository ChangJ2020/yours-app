/**
 * Yours App (YA) · 核心数据契约
 * ------------------------------------------------------------------
 * 这里定义全系统唯一的 Spec 规范（App Spec Standard v2）。
 * 所有引擎（表单/表格/Spec 预览/迁移）都只依赖本文件的结构，
 * 保证「AI 输出 → 解析 → 渲染 → 存储」链路类型一致。
 */

/** 支持的字段控件类型 */
export const FIELD_TYPES = [
  { type: 'text', label: '单行文本', icon: '字', hint: '姓名、标题、编号等短文本' },
  { type: 'textarea', label: '多行文本', icon: '段', hint: '备注、描述、工作内容' },
  { type: 'number', label: '数字', icon: '数', hint: '数量、金额、工时' },
  { type: 'date', label: '日期', icon: '日', hint: '按天记录' },
  { type: 'datetime', label: '日期时间', icon: '时', hint: '精确到分钟' },
  { type: 'select', label: '单选下拉', icon: '选', hint: '从固定选项中选一个' },
  { type: 'radio', label: '单选按钮', icon: '单', hint: '选项少时更直观' },
  { type: 'checkbox', label: '多选', icon: '多', hint: '可同时选择多项' },
  { type: 'switch', label: '是/否开关', icon: '开', hint: '布尔状态，如是否通过' },
  { type: 'email', label: '邮箱', icon: '@', hint: '带格式校验的邮箱' },
  { type: 'phone', label: '手机号', icon: '☎', hint: '带格式校验的手机号' },
  { type: 'rating', label: '评分', icon: '★', hint: '1~5 星主观评价' },
  { type: 'currency', label: '金额', icon: '¥', hint: '带两位小数的金额' },
]

export const FIELD_TYPE_MAP = Object.fromEntries(FIELD_TYPES.map((t) => [t.type, t]))

/** 需要用户从候选项中挑选的类型 */
export const OPTION_TYPES = ['select', 'radio', 'checkbox']

/** 数值型字段（用于表格统计） */
export const NUMERIC_TYPES = ['number', 'currency', 'rating']

/** 带 options 的字段默认选项 */
export const DEFAULT_OPTIONS = ['选项一', '选项二']

export const APP_SPEC_VERSION = '2.0.0'
export const SPEC_STORAGE_KEY = 'ya:apps'

/**
 * 生成稳定 id
 * @param {string} prefix
 */
export function uid(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${rand}`
}

/**
 * 生成语义化 key（用于字段 key / 实体 id）
 * 约束：
 *  1. 必须是合法标识符（字母/下划线开头）；
 *  2. 同一份 Spec 内必须唯一 —— 中文标签无法转拼音，所以用「标签哈希 + 位置」保证不冲突，
 *     否则两个同名字段会共用一个 key，导致删除/迁移只生效一个（真实踩过的坑）。
 * @param {string} raw 原始文本（通常是中文标签）
 * @param {string} fallback 前缀（如 field3 / myEntity）
 */
export function slugKey(raw, fallback = 'field') {
  const ascii = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (ascii && /^[a-z]/.test(ascii)) return ascii.slice(0, 40)

  const cleaned = String(raw || '')
    .replace(/[^\w\u4e00-\u9fa5]+/g, '')
    .slice(0, 12)
  if (!cleaned) return fallback === 'field' ? 'field' : fallback

  let hash = 0
  for (let i = 0; i < cleaned.length; i += 1) {
    hash = (hash * 31 + cleaned.charCodeAt(i)) >>> 0
  }
  // 带上位置后缀：即使标签完全相同也能得到互不冲突的 key
  const suffix = fallback.replace(/[^0-9a-zA-Z_]/g, '')
  return `${fallback}_${hash.toString(36).slice(0, 6)}`.slice(0, 40) + (suffix ? '' : '')
}

/** 根据字段类型推断默认值 */
export function defaultValueFor(field) {
  switch (field.type) {
    case 'number':
    case 'currency':
      return ''
    case 'rating':
      return 0
    case 'switch':
      return false
    case 'checkbox':
      return []
    default:
      return ''
  }
}

/** 规范化字段对象（补齐默认属性，剔除非法类型） */
export function normalizeField(field, index = 0) {
  const type = FIELD_TYPE_MAP[field?.type] ? field.type : 'text'
  const rawLabel = field?.label === undefined || field?.label === null ? '' : String(field.label).trim()
  const label = /^undefined|null|NaN$/.test(rawLabel) ? '' : rawLabel || `字段${index + 1}`
  const out = {
    key: field?.key && /^[A-Za-z_][\w]*$/.test(String(field.key)) ? String(field.key) : slugKey(label, `field${index + 1}`),
    label,
    type,
    required: Boolean(field?.required),
    placeholder: field?.placeholder ? String(field.placeholder) : '',
    help: field?.help ? String(field.help) : '',
  }
  if (OPTION_TYPES.includes(type)) {
    const options = Array.isArray(field?.options) ? field.options : []
    const cleaned = options
      .map((o) => (typeof o === 'string' ? o : o?.label ?? o?.value ?? ''))
      .map((o) => String(o).trim())
      .filter(Boolean)
    out.options = cleaned.length ? Array.from(new Set(cleaned)) : [...DEFAULT_OPTIONS]
  }
  if (['number', 'currency', 'rating'].includes(type)) {
    if (field?.min !== undefined && field?.min !== null && field?.min !== '') out.min = Number(field.min)
    if (field?.max !== undefined && field?.max !== null && field?.max !== '') out.max = Number(field.max)
    if (field?.step !== undefined && field?.step !== '') out.step = Number(field.step)
    if (type === 'rating') {
      out.min = out.min ?? 1
      out.max = out.max ?? 5
    }
    if (field?.unit) out.unit = String(field.unit)
  }
  return out
}

/** 规范化实体 */
export function normalizeEntity(entity, index = 0) {
  const entityName = String(entity?.entityName || `数据表${index + 1}`).trim()
  return {
    entityId: entity?.entityId || slugKey(entityName, `entity${index + 1}`),
    entityName,
    description: entity?.description || '',
    fields: (Array.isArray(entity?.fields) ? entity.fields : []).map(normalizeField),
  }
}

const PAGE_TYPES = ['form', 'table']

/** 规范化页面 */
export function normalizePage(page, index = 0) {
  const pageType = PAGE_TYPES.includes(page?.pageType) ? page.pageType : 'table'
  return {
    pageId: page?.pageId || uid('page'),
    pageTitle: String(page?.pageTitle || `页面${index + 1}`).trim(),
    pageType,
    targetEntity: page?.targetEntity || '',
    description: page?.description || '',
    features: Array.isArray(page?.features)
      ? page.features.filter((f) => ['filter', 'search', 'export_csv', 'delete_row', 'edit_row', 'chart'].includes(f))
      : pageType === 'table'
        ? ['filter', 'search', 'export_csv', 'delete_row', 'edit_row']
        : [],
  }
}

/** 规范化功能清单项 */
export function normalizeFeature(feature, index = 0) {
  return {
    id: feature?.id || uid('feat'),
    title: String(feature?.title || `功能 ${index + 1}`).trim(),
    description: feature?.description || '',
    icon: feature?.icon || '📌',
    relatedEntityIds: Array.isArray(feature?.relatedEntityIds) ? feature.relatedEntityIds.filter(Boolean) : [],
  }
}

/** 规范化整份 Spec（防御性：AI 返回的任何脏数据都要能安全落地） */
export function normalizeSpec(spec = {}, fallback = {}) {
  const entities = (Array.isArray(spec.entities) ? spec.entities : []).map(normalizeEntity)
  if (!entities.length) {
    entities.push({
      entityId: 'record',
      entityName: String(spec.appName || fallback.appName || '记录').slice(0, 12),
      description: '',
      fields: [],
    })
  }
  const known = new Set(entities.map((e) => e.entityId))
  const pages = (Array.isArray(spec.pages) ? spec.pages : []).map(normalizePage).map((p) => ({
    ...p,
    targetEntity: known.has(p.targetEntity) ? p.targetEntity : entities[0].entityId,
  }))
  if (!pages.length) {
    pages.push(
      normalizePage({ pageTitle: '数据填报', pageType: 'form', targetEntity: entities[0].entityId }),
      normalizePage({ pageTitle: '数据明细', pageType: 'table', targetEntity: entities[0].entityId }),
    )
  }
  const featureList = (Array.isArray(spec.featureList) ? spec.featureList : []).map(normalizeFeature)

  return {
    appId: spec.appId || fallback.appId || uid('app'),
    appName: String(spec.appName || fallback.appName || '未命名应用').trim(),
    version: spec.version || fallback.version || '1.0.0',
    description: spec.description || fallback.description || '',
    icon: spec.icon || fallback.icon || '🧩',
    createdAt: spec.createdAt || fallback.createdAt || new Date().toISOString(),
    updatedAt: spec.updatedAt || new Date().toISOString(),
    specVersion: APP_SPEC_VERSION,
    entities,
    pages,
    featureList,
    changelog: Array.isArray(spec.changelog) ? spec.changelog : [],
  }
}

/** 取实体 */
export function getEntity(spec, entityId) {
  if (!spec?.entities?.length) return null
  return spec.entities.find((e) => e.entityId === entityId) || spec.entities[0]
}

/** 语义化版本号自增：1.0.0 -> 1.1.0 */
export function bumpMinorVersion(version = '1.0.0') {
  const parts = String(version)
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  while (parts.length < 3) parts.push(0)
  parts[1] += 1
  parts[2] = 0
  return parts.join('.')
}

/** 轻量深拷贝（Spec 为纯 JSON 结构） */
export function cloneSpec(spec) {
  return JSON.parse(JSON.stringify(spec))
}
