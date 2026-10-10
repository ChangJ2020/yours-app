<template>
  <div class="sync-bar" :data-state="state">
    <div class="status">
      <span class="dot" />
      <div>
        <div class="status-title">{{ statusTitle }}</div>
        <div class="status-sub">{{ statusSub }}</div>
      </div>
    </div>

    <div v-if="changeChips.length" class="chips">
      <span v-for="(c, i) in changeChips" :key="i" class="chip" :data-tone="c.tone">{{ c.text }}</span>
    </div>

    <div class="actions">
      <button class="ya-btn ya-btn-ghost" :disabled="!dirty || busy" @click="emit('sync')">
        ⚡ 同步更新详细 Spec
      </button>
      <button class="ya-btn ya-btn-success" :disabled="!dirty || busy" @click="emit('rebuild')">
        🚀 重新构建并运行应用
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  dirty: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  currentVersion: { type: String, default: '1.0.0' },
  summary: { type: String, default: '' },
  changeChips: { type: Array, default: () => [] },
})

const emit = defineEmits(['sync', 'rebuild'])

const state = computed(() => (props.busy ? 'busy' : props.dirty ? 'dirty' : 'clean'))

const statusTitle = computed(() => {
  if (props.busy) return '正在执行数据迁移与热重建…'
  if (props.dirty) return '功能清单已改动，详细 Spec 待同步'
  return '功能清单与详细 Spec 已保持最新'
})

const statusSub = computed(() => {
  if (props.busy) return '请稍候，历史数据将无损迁移'
  if (props.dirty) return props.summary || '点击右侧按钮同步并重建，版本号自动升级'
  return `当前版本 v${props.currentVersion} · 无待应用的改动`
})
</script>

<style scoped>
.sync-bar {
  position: sticky;
  bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md);
  transition: border-color var(--dur), box-shadow var(--dur);
}

.sync-bar[data-state='dirty'] {
  border-color: color-mix(in srgb, var(--warn-500) 45%, transparent);
  box-shadow: 0 10px 30px color-mix(in srgb, var(--warn-500) 18%, transparent);
}

.sync-bar[data-state='busy'] {
  border-color: color-mix(in srgb, var(--brand-500) 45%, transparent);
}

.status {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
  background: var(--ok-500);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok-500) 16%, transparent);
}

.sync-bar[data-state='dirty'] .dot {
  background: var(--warn-500);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--warn-500) 18%, transparent);
  animation: ya-blink 1.4s infinite;
}

.sync-bar[data-state='busy'] .dot {
  background: var(--brand-500);
  animation: ya-blink 0.9s infinite;
}

.status-title {
  font-size: 13px;
  font-weight: 650;
}

.status-sub {
  font-size: 11.5px;
  color: var(--text-muted);
}

.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
  justify-content: center;
}

.chip {
  font-size: 11.5px;
  padding: 3px 9px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  color: var(--text-secondary);
}

.chip[data-tone='ok'] {
  background: var(--ok-50);
  color: var(--ok-600);
}

.chip[data-tone='warn'] {
  background: var(--warn-50);
  color: var(--warn-600);
}

.chip[data-tone='info'] {
  background: var(--info-50);
  color: var(--info-500);
}

.actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 860px) {
  .chips {
    display: none;
  }
  .actions {
    width: 100%;
  }
  .actions .ya-btn {
    flex: 1;
  }
}
</style>
