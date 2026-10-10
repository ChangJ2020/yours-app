<template>
  <div class="panel" :data-tone="tone">
    <div class="panel-head">
      <div class="ya-row" style="gap: 8px">
        <span class="panel-icon">{{ icon }}</span>
        <div>
          <div class="panel-title">{{ title }}</div>
          <div v-if="subtitle" class="panel-sub">{{ subtitle }}</div>
        </div>
      </div>
      <div class="ya-row">
        <slot name="head-actions" />
        <button class="collapse" :aria-label="open ? '收起' : '展开'" @click="open = !open">
          {{ open ? '收起 ▴' : '展开 ▾' }}
        </button>
      </div>
    </div>
    <div v-show="open" class="panel-body">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  icon: { type: String, default: '🧩' },
  tone: { type: String, default: 'default' },
})

const open = ref(true)
</script>

<style scoped>
.panel {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-xs);
}

.panel[data-tone='brand'] {
  border-color: color-mix(in srgb, var(--brand-500) 32%, transparent);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 12px 16px;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
}

.panel-icon {
  font-size: 16px;
}

.panel-title {
  font-size: 13.5px;
  font-weight: 650;
}

.panel-sub {
  font-size: 11.5px;
  color: var(--text-muted);
}

.panel-body {
  padding: 14px 16px;
  animation: ya-fade-up 200ms var(--ease-out) both;
}

.collapse {
  font-size: 12px;
  color: var(--text-muted);
  padding: 3px 8px;
  border-radius: var(--radius-xs);
}

.collapse:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
