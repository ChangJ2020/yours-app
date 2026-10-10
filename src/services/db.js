/**
 * Yours App (YA) · IndexedDB 轻量封装
 * 对象仓库设计：
 *   apps_meta      —— 所有应用的 Spec（keyPath: appId）
 *   app_records    —— 所有应用的表单数据（keyPath: id，索引 appId / appId_entityId）
 *   app_versions   —— 版本快照（keyPath: id，索引 appId）
 */

const DB_NAME = 'yours_app_db'
const DB_VERSION = 2

export const STORE = {
  APPS: 'apps_meta',
  RECORDS: 'app_records',
  VERSIONS: 'app_versions',
}

let dbPromise = null

function openDatabase() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE.APPS)) {
        db.createObjectStore(STORE.APPS, { keyPath: 'appId' })
      }
      if (!db.objectStoreNames.contains(STORE.RECORDS)) {
        const store = db.createObjectStore(STORE.RECORDS, { keyPath: 'id' })
        store.createIndex('appId', 'appId', { unique: false })
        store.createIndex('appEntity', ['appId', 'entityId'], { unique: false })
      } else {
        const store = req.transaction.objectStore(STORE.RECORDS)
        if (!store.indexNames.contains('appEntity')) {
          store.createIndex('appEntity', ['appId', 'entityId'], { unique: false })
        }
      }
      if (!db.objectStoreNames.contains(STORE.VERSIONS)) {
        const vstore = db.createObjectStore(STORE.VERSIONS, { keyPath: 'id' })
        vstore.createIndex('appId', 'appId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('打开本地数据库失败'))
  })
  return dbPromise
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName)
}

const wrap = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

export async function dbGetAll(storeName) {
  const db = await openDatabase()
  return wrap(tx(db, storeName, 'readonly').getAll())
}

export async function dbGet(storeName, key) {
  const db = await openDatabase()
  return wrap(tx(db, storeName, 'readonly').get(key))
}

export async function dbPut(storeName, value) {
  const db = await openDatabase()
  await wrap(tx(db, storeName, 'readwrite').put(value))
  return value
}

export async function dbBulkPut(storeName, values = []) {
  if (!values.length) return []
  const db = await openDatabase()
  const store = tx(db, storeName, 'readwrite')
  await Promise.all(values.map((v) => wrap(store.put(v))))
  return values
}

export async function dbDelete(storeName, key) {
  const db = await openDatabase()
  return wrap(tx(db, storeName, 'readwrite').delete(key))
}

export async function dbClear(storeName) {
  const db = await openDatabase()
  return wrap(tx(db, storeName, 'readwrite').clear())
}

/** 按索引查询 */
export async function dbGetByIndex(storeName, indexName, query) {
  const db = await openDatabase()
  const store = tx(db, storeName, 'readonly')
  return wrap(store.index(indexName).getAll(query))
}

/** 删除某 App 的全部数据（应用 + 记录 + 快照） */
export async function deleteAppCascade(appId) {
  const [records, versions] = await Promise.all([
    dbGetByIndex(STORE.RECORDS, 'appId', appId),
    dbGetByIndex(STORE.VERSIONS, 'appId', appId),
  ])
  await Promise.all([
    ...records.map((r) => dbDelete(STORE.RECORDS, r.id)),
    ...versions.map((v) => dbDelete(STORE.VERSIONS, v.id)),
    dbDelete(STORE.APPS, appId),
  ])
  return { removedRecords: records.length, removedVersions: versions.length }
}

export async function resetAll() {
  await Promise.all([dbClear(STORE.APPS), dbClear(STORE.RECORDS), dbClear(STORE.VERSIONS)])
}

/** 粗略估算本地占用（用于首页展示） */
export async function estimateUsage() {
  try {
    if (navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate()
      return { usage, quota }
    }
  } catch {
    /* ignore */
  }
  return { usage: 0, quota: 0 }
}
