<template>
  <div class="tbl-wrap">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div v-if="has('search')" class="search">
        <span class="search-icon">🔍</span>
        <input
          v-model="query"
          class="ya-input search-input"
          type="search"
          placeholder="搜索全部字段，例如姓名、项目、备注…"
        />
        <button v-if="query" class="clear" aria-label="清空搜索" @click="query = ''">✕</button>
      </div>

      <div class="ya-row" style="flex-wrap: wrap; gap: 8px">
        <select v-if="has('filter')" v-model="filterKey" class="ya-select" style="width: auto">
          <option value="">按字段筛选…</option>
          <option v-for="f in filterableFields" :key="f.key" :value="f.key">{{ f.label }}</option>
        </select>
        <select v-if="has('filter') && filterKey" v-model="filterValue" class="ya-select" style="width: auto">
          <option value="">全部</option>
          <option v-for="opt in filterOptions" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <button
          v-if="has('export_csv')"
          class="ya-btn ya-btn-ghost ya-btn-sm"
          :disabled="!filtered.length"
          @click="emit('export')"
        >
          📤 导出 CSV ({{ filtered.length }})
        </button>
        <button v-if="filtered.length" class="ya-btn ya-btn-quiet ya-btn-sm" @click="resetFilters">重置筛选</button>
      </div>
    </div>

    <!-- 表格 -->
    <div v-if="filtered.length" class="ya-table-wrap">
      <table class="ya-table">
        <thead>
          <tr>
            <th style="width: 54px">#</th>
            <th
              v-for="field in entity.fields"
              :key="field.key"
              :style="{ cursor: 'pointer' }"
              :title="`按「${field.label}」排序`"
              @click="toggleSort(field.key)"
            >
              {{ field.label }}
              <span v-if="sortKey === field.key" class="sort-mark">{{ sortDir === 'asc' ? '▲' : '▼' }}</span>
            </th>
            <th>提交时间</th>
            <th v-if="has('edit_row') || has('delete_row')" class="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(record, i) in paged" :key="record.id">
            <td class="ya-muted num">{{ (page - 1) * pageSize + i + 1 }}</td>
            <td v-for="field in entity.fields" :key="field.key" :class="{ num: isNum(field) }">
              <span v-if="field.type === 'switch'" class="ya-badge" :class="record.values?.[field.key] ? 'ya-badge-ok' : ''">
                {{ record.values?.[field.key] ? '是' : '否' }}
              </span>
              <span v-else-if="field.type === 'rating'" class="stars">
                {{ '★'.repeat(Number(record.values?.[field.key]) || 0) }}
              </span>
              <span v-else-if="field.type === 'currency'">{{ formatCurrency(record.values?.[field.key]) }}</span>
              <span v-else-if="Array.isArray(record.values?.[field.key])" class="chips-cell">
                <span v-for="v in record.values[field.key]" :key="v" class="mini-chip">{{ v }}</span>
              </span>
              <span v-else-if="!record.values?.[field.key] && record._missing?.includes(field.key)" class="ya-badge ya-badge-warn">
                待补充
              </span>
              <span v-else>{{ displayValue(field, record.values?.[field.key]) }}</span>
            </td>
            <td class="ya-muted" style="white-space: nowrap">{{ shortTime(record.createdAt) }}</td>
            <td v-if="has('edit_row') || has('delete_row')" class="col-actions">
              <div class="ya-row" style="justify-content: flex-end; gap: 4px">
                <button v-if="has('edit_row')" class="ya-btn ya-btn-quiet ya-btn-sm" @click="emit('edit', record)">
                  ✏️ 编辑
                </button>
                <button v-if="has('delete_row')" class="ya-btn ya-btn-quiet ya-btn-sm danger" @click="emit('delete', record)">
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="ya-empty">
      <div class="ya-empty-icon">{{ records.length ? '🔍' : '📭' }}</div>
      <div style="font-weight: 600; color: var(--text-secondary)">
        {{ records.length ? '没有符合条件的记录' : '还没有任何数据' }}
      </div>
      <div style="font-size: 12.5px; margin-top: 4px">
        {{ records.length ? '换个关键词或重置筛选试试' : '切换到「填报」页面提交第一条记录吧' }}
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="filtered.length > pageSize" class="pager">
      <span class="ya-muted" style="font-size: 12px">
        共 {{ filtered.length }} 条 · 第 {{ page }} / {{ totalPages }} 页
      </span>
      <div class="ya-row">
        <button class="ya-btn ya-btn-ghost ya-btn-sm" :disabled="page === 1" @click="page -= 1">上一页</button>
        <button class="ya-btn ya-btn-ghost ya-btn-sm" :disabled="page === totalPages" @click="page += 1">下一页</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { NUMERIC_TYPES, OPTION_TYPES } from '@/engine/spec.js'
import { displayValue } from '@/utils/format.js'

const props = defineProps({
  entity: { type: Object, required: true },
  records: { type: Array, default: () => [] },
  features: { type: Array, default: () => ['search', 'filter', 'export_csv', 'delete_row', 'edit_row'] },
  pageSize: { type: Number, default: 10 },
})

const emit = defineEmits(['export', 'delete', 'edit'])

const query = ref('')
const filterKey = ref('')
const filterValue = ref('')
const sortKey = ref('')
const sortDir = ref('desc')
const page = ref(1)

const has = (feature) => props.features.includes(feature)
const isNum = (field) => NUMERIC_TYPES.includes(field.type)

const filterableFields = computed(() =>
  (props.entity.fields || []).filter((f) => OPTION_TYPES.includes(f.type) || ['switch', 'date'].includes(f.type)),
)

const filterOptions = computed(() => {
  const field = props.entity.fields.find((f) => f.key === filterKey.value)
  if (!field) return []
  if (OPTION_TYPES.includes(field.type)) return field.options || []
  if (field.type === 'switch') return ['是', '否']
  // 日期字段：给出已出现的年月
  const months = new Set()
  for (const r of props.records) {
    const v = String(r.values?.[field.key] || '')
    if (v.length >= 7) months.add(v.slice(0, 7))
  }
  return [...months].sort().reverse()
})

const filtered = computed(() => {
  let rows = [...props.records]
  const q = query.value.trim().toLowerCase()

  if (q && has('search')) {
    rows = rows.filter((r) =>
      (props.entity.fields || []).some((f) => {
        const v = r.values?.[f.key]
        if (v === undefined || v === null) return false
        return String(Array.isArray(v) ? v.join(' ') : v).toLowerCase().includes(q)
      }),
    )
  }

  if (filterKey.value && filterValue.value) {
    const field = props.entity.fields.find((f) => f.key === filterKey.value)
    const target = filterValue.value
    rows = rows.filter((r) => {
      const v = r.values?.[field.key]
      if (field.type === 'switch') return (v ? '是' : '否') === target
      if (field.type === 'date') return String(v || '').startsWith(target)
      return String(v) === target
    })
  }

  if (sortKey.value) {
    const dir = sortDir.value === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      const av = a.values?.[sortKey.value]
      const bv = b.values?.[sortKey.value]
      if (av === undefined || av === '') return 1
      if (bv === undefined || bv === '') return -1
      const na = Number(av)
      const nb = Number(bv)
      if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir
      return String(av).localeCompare(String(bv), 'zh-CN') * dir
    })
  }

  return rows
})

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / props.pageSize)))
const paged = computed(() => {
  const start = (page.value - 1) * props.pageSize
  return filtered.value.slice(start, start + props.pageSize)
})

watch([query, filterKey, filterValue], () => {
  page.value = 1
})

watch(
  () => filtered.value.length,
  () => {
    if (page.value > totalPages.value) page.value = totalPages.value
  },
)

function toggleSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

function resetFilters() {
  query.value = ''
  filterKey.value = ''
  filterValue.value = ''
  sortKey.value = ''
}

function formatCurrency(v) {
  if (v === undefined || v === null || v === '') return ''
  return `¥${Number(v).toFixed(2)}`
}

function shortTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

defineExpose({ filtered, resetFilters })
</script>

<style scoped>
.tbl-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.search {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 240px;
  flex: 1;
  max-width: 420px;
}

.search-icon {
  position: absolute;
  left: 11px;
  font-size: 12px;
  opacity: 0.7;
  pointer-events: none;
}

.search-input {
  padding-left: 30px;
}

.clear {
  position: absolute;
  right: 8px;
  font-size: 11px;
  color: var(--text-muted);
  padding: 2px 6px;
  border-radius: 5px;
}

.clear:hover {
  background: var(--bg-hover);
}

.sort-mark {
  font-size: 9px;
  color: var(--brand-500);
}

.stars {
  color: var(--warn-500);
  letter-spacing: 1px;
}

.chips-cell {
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
}

.mini-chip {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  color: var(--text-secondary);
}

.danger:hover {
  color: var(--danger-600) !important;
  background: var(--danger-50) !important;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
</style>
