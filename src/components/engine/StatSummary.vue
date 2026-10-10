<template>
  <div class="stats">
    <div class="stat">
      <span class="stat-icon">🗂️</span>
      <div>
        <div class="stat-value">{{ total }}</div>
        <div class="stat-label">记录总数</div>
      </div>
    </div>
    <div v-for="s in numericStats" :key="s.key" class="stat">
      <span class="stat-icon">{{ s.icon }}</span>
      <div>
        <div class="stat-value">{{ s.value }}</div>
        <div class="stat-label">{{ s.label }}</div>
      </div>
    </div>
    <div v-if="recent" class="stat">
      <span class="stat-icon">🕒</span>
      <div>
        <div class="stat-value" style="font-size: 14px">{{ recent }}</div>
        <div class="stat-label">最近提交</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { timeAgo } from '@/utils/format.js'

const props = defineProps({
  entity: { type: Object, required: true },
  records: { type: Array, default: () => [] },
})

const total = computed(() => props.records.length)

const recent = computed(() => {
  const sorted = [...props.records].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  return sorted[0] ? timeAgo(sorted[0].createdAt) : ''
})

const numericStats = computed(() => {
  const out = []
  for (const field of props.entity.fields || []) {
    if (field.type === 'currency') {
      const sum = props.records.reduce((acc, r) => acc + (Number(r.values?.[field.key]) || 0), 0)
      out.push({ key: field.key, icon: '💰', label: `${field.label}合计`, value: `¥${sum.toFixed(2)}` })
    } else if (field.type === 'number') {
      const nums = props.records.map((r) => Number(r.values?.[field.key])).filter((n) => Number.isFinite(n))
      if (!nums.length) continue
      const sum = nums.reduce((a, b) => a + b, 0)
      out.push({
        key: field.key,
        icon: 'Σ',
        label: `${field.label}合计`,
        value: `${Number(sum.toFixed(2))}${field.unit || ''} · 均值 ${Number((sum / nums.length).toFixed(1))}`,
      })
    }
  }
  return out.slice(0, 3)
})
</script>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
}

.stat {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-xs);
}

.stat-icon {
  width: 34px;
  height: 34px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--brand-50);
  color: var(--brand-600);
  font-size: 15px;
  font-weight: 700;
}

.stat-value {
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}

.stat-label {
  font-size: 11.5px;
  color: var(--text-muted);
}
</style>
