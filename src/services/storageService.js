/**
 * Yours App (YA) · 存储适配层（Repository）
 * ------------------------------------------------------------------
 * 对上层屏蔽 IndexedDB 细节，提供「应用元数据 / 表单数据 / 版本快照」三类能力，
 * 并按 appId + entityId 隔离不同应用的数据（对齐 PRD 模块 5）。
 */

import { cloneSpec, uid } from '@/engine/spec.js'
import { bumpMinorVersion } from '@/engine/diff.js'
import { STORE, dbBulkPut, dbDelete, dbGet, dbGetAll, dbGetByIndex, dbPut, deleteAppCascade, resetAll } from './db.js'

/* ------------------------------- 应用元数据 ------------------------------- */

export async function listApps() {
  const apps = await dbGetAll(STORE.APPS)
  return apps.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
}

export async function getApp(appId) {
  return dbGet(STORE.APPS, appId)
}

/** 保存应用（自动写入版本快照） */
export async function saveApp(spec, { snapshotLabel = '保存' } = {}) {
  const next = { ...cloneSpec(spec), updatedAt: new Date().toISOString() }
  await dbPut(STORE.APPS, next)
  await createSnapshot(next, snapshotLabel)
  return next
}

export async function removeApp(appId) {
  return deleteAppCascade(appId)
}

/* --------------------------------- 记录 --------------------------------- */

export async function listRecords(appId, entityId) {
  const rows = await dbGetByIndex(STORE.RECORDS, 'appEntity', [appId, entityId])
  return rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
}

export async function countRecords(appId) {
  const rows = await dbGetByIndex(STORE.RECORDS, 'appId', appId)
  return rows.length
}

/** 批量统计所有应用的记录数（首页卡片用） */
export async function countRecordsByApp() {
  const rows = await dbGetAll(STORE.RECORDS)
  const map = {}
  for (const row of rows) map[row.appId] = (map[row.appId] || 0) + 1
  return map
}

export async function createRecord(appId, entityId, values) {
  const record = {
    id: uid('rec'),
    appId,
    entityId,
    values,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await dbPut(STORE.RECORDS, record)
  return record
}

export async function updateRecord(id, values) {
  const prev = await dbGet(STORE.RECORDS, id)
  if (!prev) throw new Error('记录不存在')
  const next = { ...prev, values, updatedAt: new Date().toISOString() }
  await dbPut(STORE.RECORDS, next)
  return next
}

export async function removeRecord(id) {
  return dbDelete(STORE.RECORDS, id)
}

export async function removeManyRecords(ids = []) {
  await Promise.all(ids.map((id) => dbDelete(STORE.RECORDS, id)))
  return ids.length
}

/* ------------------------------- 版本快照 ------------------------------- */

export async function createSnapshot(spec, label = '快照') {
  const snap = {
    id: uid('ver'),
    appId: spec.appId,
    version: spec.version,
    label,
    createdAt: new Date().toISOString(),
    spec: cloneSpec(spec),
  }
  await dbPut(STORE.VERSIONS, snap)
  // 仅保留最近 12 个快照，避免本地存储无限膨胀
  const all = await dbGetByIndex(STORE.VERSIONS, 'appId', spec.appId)
  const sorted = all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  const extra = sorted.slice(12)
  await Promise.all(extra.map((s) => dbDelete(STORE.VERSIONS, s.id)))
  return snap
}

export async function listSnapshots(appId) {
  const all = await dbGetByIndex(STORE.VERSIONS, 'appId', appId)
  return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

/* ------------------------------ 主流程：构建 ----------------------------- */

/**
 * 首次构建应用：写入 Spec + 初始化数据表空间
 * @param {object} spec 已规范化的 Spec
 */
export async function buildApp(spec) {
  const withVersion = { ...spec, version: spec.version || '1.0.0', createdAt: spec.createdAt || new Date().toISOString() }
  withVersion.changelog = [
    { version: withVersion.version, at: new Date().toISOString(), note: '首次生成应用' },
    ...(withVersion.changelog || []),
  ]
  return saveApp(withVersion, { snapshotLabel: `生成 v${withVersion.version}` })
}

/**
 * 重新构建（Rebuild）：热升级 Spec + 数据无损迁移
 * @param {object} params
 * @param {object} params.currentSpec 现有 Spec
 * @param {object} params.nextSpec 新编译出的 Spec
 * @param {Function} params.migrate 迁移函数 (records, oldSpec, newSpec) => {records, stats}
 * @param {string[]} [params.changeNotes] 变更说明（写入 changelog）
 */
export async function rebuildApp({ currentSpec, nextSpec, migrate, changeNotes = [] }) {
  const entityId = currentSpec.entities?.[0]?.entityId
  const records = await listRecords(currentSpec.appId, entityId)

  const { records: migrated, stats } = migrate(records, currentSpec, nextSpec)

  const version = bumpMinorVersion(currentSpec.version)
  const newEntity = nextSpec.entities?.[0]

  // 迁移后记录统一指向新实体
  const toWrite = migrated.map((r) => ({ ...r, entityId: newEntity.entityId, appId: currentSpec.appId }))

  const finalSpec = {
    ...cloneSpec(nextSpec),
    appId: currentSpec.appId,
    version,
    createdAt: currentSpec.createdAt,
    updatedAt: new Date().toISOString(),
    changelog: [
      { version, at: new Date().toISOString(), note: changeNotes.join('；') || '结构与功能升级' },
      ...(currentSpec.changelog || []),
    ],
  }

  // 先写记录再写元数据，避免中途失败导致元数据与数据不一致
  if (toWrite.length) await dbBulkPut(STORE.RECORDS, toWrite)
  // 旧实体 id 变化的记录：删除旧实体下的残留
  if (entityId !== newEntity.entityId) {
    const stale = records.filter((r) => r.entityId === entityId && !toWrite.some((t) => t.id === r.id))
    await Promise.all(stale.map((r) => dbDelete(STORE.RECORDS, r.id)))
  }

  const saved = await saveApp(finalSpec, { snapshotLabel: `升级到 v${version}` })
  return { spec: saved, stats, version, migratedCount: toWrite.length }
}

/* ------------------------------ 导入 / 导出 ----------------------------- */

/** 导出应用配置（含数据） */
export async function exportApp(appId, { includeRecords = true } = {}) {
  const spec = await getApp(appId)
  if (!spec) throw new Error('应用不存在')
  const payload = {
    kind: 'yours-app-export',
    exportedAt: new Date().toISOString(),
    spec,
  }
  if (includeRecords) {
    payload.records = await dbGetByIndex(STORE.RECORDS, 'appId', appId)
  }
  return payload
}

/** 导入应用配置 */
export async function importApp(payload) {
  if (!payload?.spec?.appName) throw new Error('文件格式不正确，缺少应用信息')
  const spec = cloneSpec(payload.spec)
  // 避免 appId 冲突
  const existing = await getApp(spec.appId)
  if (existing) {
    spec.appId = uid('app')
    spec.appName = `${spec.appName}（导入副本）`
  }
  await saveApp(spec, { snapshotLabel: '导入配置' })
  if (Array.isArray(payload.records) && payload.records.length) {
    const rows = payload.records.map((r) => ({ ...r, id: uid('rec'), appId: spec.appId }))
    await dbBulkPut(STORE.RECORDS, rows)
  }
  return spec
}

export { resetAll }
