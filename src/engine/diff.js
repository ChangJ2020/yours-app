/**
 * Yours App (YA) · Spec Diff & Patch 引擎
 * ------------------------------------------------------------------
 * 支撑 PRD 第 3 章「功能清单修改 → Spec 联动 → 重新构建」闭环：
 * 1. diffSpec      ：比对两版 Spec，产出给用户看的变更清单（含数据影响预警）
 * 2. migrateRecords：数据无损迁移，被删除字段的旧数据进入 _archived 归档区
 * 3. bumpVersion   ：版本号升位
 */

import { bumpMinorVersion, defaultValueFor, getEntity } from './spec.js'

/**
 * 比对两版 Spec
 * @param {object} oldSpec
 * @param {object} newSpec
 */
export function diffSpec(oldSpec, newSpec) {
  const changes = []
  const oldEntity = oldSpec?.entities?.[0]
  const newEntity = newSpec?.entities?.[0]

  const oldFields = new Map((oldEntity?.fields || []).map((f) => [f.key, f]))
  const newFields = new Map((newEntity?.fields || []).map((f) => [f.key, f]))

  const addedFields = []
  const removedFields = []
  const updatedFields = []

  for (const [key, f] of newFields) {
    if (!oldFields.has(key)) {
      addedFields.push(f)
      changes.push({ kind: 'field_add', entityId: newEntity?.entityId, target: f.label, detail: `新增字段「${f.label}」(${f.type}${f.required ? '，必填' : ''})` })
      continue
    }
    const prev = oldFields.get(key)
    const diffs = []
    if (prev.type !== f.type) diffs.push(`类型 ${prev.type} → ${f.type}`)
    if (prev.label !== f.label) diffs.push(`名称「${prev.label}」→「${f.label}」`)
    if (Boolean(prev.required) !== Boolean(f.required)) diffs.push(f.required ? '改为必填' : '改为非必填')
    if (JSON.stringify(prev.options || []) !== JSON.stringify(f.options || [])) diffs.push('选项发生变化')
    if (JSON.stringify([prev.min, prev.max]) !== JSON.stringify([f.min, f.max])) diffs.push('取值范围发生变化')
    if (diffs.length) {
      updatedFields.push({ field: f, diffs })
      changes.push({ kind: 'field_update', entityId: newEntity?.entityId, target: f.label, detail: `字段「${f.label}」：${diffs.join('；')}` })
    }
  }
  for (const [key, f] of oldFields) {
    if (!newFields.has(key)) {
      removedFields.push(f)
      changes.push({ kind: 'field_remove', entityId: oldEntity?.entityId, target: f.label, detail: `删除字段「${f.label}」（历史数据将归档保留）` })
    }
  }

  /* 页面变化 */
  const oldPages = new Map((oldSpec?.pages || []).map((p) => [p.pageId, p]))
  const newPages = new Map((newSpec?.pages || []).map((p) => [p.pageId, p]))
  const addedPages = []
  const removedPages = []
  for (const [id, p] of newPages) {
    if (!oldPages.has(id)) {
      addedPages.push(p)
      changes.push({ kind: 'page_add', target: p.pageTitle, detail: `新增页面「${p.pageTitle}」(${p.pageType === 'form' ? '表单' : '表格'})` })
      continue
    }
    const prev = oldPages.get(id)
    const added = (p.features || []).filter((x) => !(prev.features || []).includes(x))
    const removed = (prev.features || []).filter((x) => !(p.features || []).includes(x))
    if (added.length || removed.length || prev.pageTitle !== p.pageTitle) {
      const parts = []
      if (prev.pageTitle !== p.pageTitle) parts.push(`标题「${prev.pageTitle}」→「${p.pageTitle}」`)
      if (added.length) parts.push(`增加能力 ${added.join(', ')}`)
      if (removed.length) parts.push(`移除能力 ${removed.join(', ')}`)
      changes.push({ kind: 'page_update', target: p.pageTitle, detail: `页面「${p.pageTitle}」：${parts.join('；')}` })
    }
  }
  for (const [id, p] of oldPages) {
    if (!newPages.has(id)) {
      removedPages.push(p)
      changes.push({ kind: 'page_remove', target: p.pageTitle, detail: `移除页面「${p.pageTitle}」` })
    }
  }

  /* 功能清单变化 */
  const oldFeat = new Map((oldSpec?.featureList || []).map((f) => [f.title, f]))
  const newFeat = new Map((newSpec?.featureList || []).map((f) => [f.title, f]))
  const addedFeatures = [...newFeat.values()].filter((f) => !oldFeat.has(f.title))
  const removedFeatures = [...oldFeat.values()].filter((f) => !newFeat.has(f.title))
  for (const f of addedFeatures) changes.push({ kind: 'feature_add', target: f.title, detail: `新增功能「${f.title}」` })
  for (const f of removedFeatures) changes.push({ kind: 'feature_remove', target: f.title, detail: `移除功能「${f.title}」` })

  const metaChanges = []
  if (oldSpec?.appName !== newSpec?.appName) metaChanges.push(`应用名：「${oldSpec?.appName}」→「${newSpec?.appName}」`)
  if (oldSpec?.description !== newSpec?.description) metaChanges.push('应用描述已更新')

  const dataAffecting = removedFields.length > 0
  const hasChanges = changes.length > 0 || metaChanges.length > 0

  return {
    changes,
    metaChanges,
    addedFields,
    removedFields,
    updatedFields,
    addedPages,
    removedPages,
    addedFeatures,
    removedFeatures,
    dataAffecting,
    hasChanges,
    summary:
      changes.length === 0
        ? '未检测到结构变化'
        : `共 ${changes.length} 处变更：新增字段 ${addedFields.length}，修改字段 ${updatedFields.length}，删除字段 ${removedFields.length}，页面变化 ${addedPages.length + removedPages.length}`,
  }
}

/**
 * 数据无损迁移
 * - 新字段：按类型补默认值（旧记录标记为「待补充」）
 * - 删除字段：原值移入 _archived，避免静默丢数据
 * - 类型变更：尽力转换（number/currency ↔ text 等），无法转换则归档原值
 *
 * @param {Array<object>} records 旧记录数组
 * @param {object} oldSpec
 * @param {object} newSpec
 * @returns {{records:Array, stats:object}}
 */
export function migrateRecords(records = [], oldSpec, newSpec) {
  const oldEntity = getEntity(oldSpec, newSpec?.entities?.[0]?.entityId) || oldSpec?.entities?.[0]
  const newEntity = newSpec?.entities?.[0]
  const oldFields = new Map((oldEntity?.fields || []).map((f) => [f.key, f]))
  const newFields = newEntity?.fields || []

  const addedKeys = newFields.filter((f) => !oldFields.has(f.key))
  const removedKeys = [...oldFields.values()].filter((f) => !newFields.some((n) => n.key === f.key))
  const typeChanged = newFields.filter((f) => oldFields.has(f.key) && oldFields.get(f.key).type !== f.type)

  let archivedCount = 0
  const out = records.map((record) => {
    const next = { ...record }
    next.values = { ...(record.values || {}) }
    next._archived = { ...(record._archived || {}) }
    next._missing = []

    for (const f of addedKeys) {
      if (next.values[f.key] === undefined) {
        next.values[f.key] = defaultValueFor(f)
        next._missing.push(f.key)
      }
    }

    for (const f of removedKeys) {
      if (next.values[f.key] !== undefined) {
        next._archived[f.key] = { label: f.label, type: f.type, value: next.values[f.key], archivedAt: new Date().toISOString() }
        delete next.values[f.key]
        archivedCount += 1
      }
    }

    for (const f of typeChanged) {
      const prev = oldFields.get(f.key)
      const v = next.values[f.key]
      if (v === undefined || v === null || v === '') continue
      const num = Number(v)
      const target = f.type
      if (['number', 'currency', 'rating'].includes(target)) {
        if (Number.isFinite(num)) next.values[f.key] = num
        else {
          next._archived[f.key] = { label: prev.label, type: prev.type, value: v, archivedAt: new Date().toISOString(), reason: '类型变更无法转换' }
          next.values[f.key] = defaultValueFor(f)
          archivedCount += 1
        }
      } else if (target === 'text' || target === 'textarea') {
        next.values[f.key] = String(v)
      } else if (target === 'switch') {
        next.values[f.key] = v === true || v === 'true' || v === 1 || v === '1'
      }
    }

    if (!next._missing.length) delete next._missing
    if (!Object.keys(next._archived).length) delete next._archived
    return next
  })

  return {
    records: out,
    stats: {
      total: records.length,
      addedFields: addedKeys.map((f) => f.label),
      removedFields: removedKeys.map((f) => f.label),
      typeChangedFields: typeChanged.map((f) => f.label),
      archivedValues: archivedCount,
      patchedRecords: out.filter((r) => Array.isArray(r._missing) && r._missing.length).length,
    },
  }
}

/** 产出面向用户的变更说明（用于重新构建前的二次确认弹窗） */
export function buildRebuildNotice(diff, stats) {
  const lines = []
  if (diff.metaChanges.length) lines.push({ tone: 'info', text: diff.metaChanges.join('；') })
  for (const c of diff.changes) lines.push({ tone: c.kind.includes('remove') ? 'warn' : 'ok', text: c.detail })
  if (stats?.archivedValues) {
    lines.push({ tone: 'warn', text: `已有 ${stats.archivedValues} 处历史数据被移入归档区（_archived），不会丢失` })
  }
  if (stats?.patchedRecords) {
    lines.push({ tone: 'info', text: `${stats.patchedRecords} 条记录的新增字段已留空，可在列表中补齐` })
  }
  return lines
}

export { bumpMinorVersion }
