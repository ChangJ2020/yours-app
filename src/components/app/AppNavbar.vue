<template>
  <header class="ya-topbar">
    <div class="ya-shell ya-topbar-inner">
      <div class="ya-row" style="gap: 12px; min-width: 0">
        <button class="ya-btn ya-btn-quiet back" title="返回首页" @click="$emit('back')">← 返回首页</button>
        <div class="divider-v" />
        <div class="app-id">
          <span class="app-emoji">{{ app.icon || '🧩' }}</span>
          <div style="min-width: 0">
            <div class="app-title">
              {{ app.appName }}
              <span class="ya-badge ya-badge-brand ya-badge-mono">v{{ app.version }}</span>
            </div>
            <div class="app-sub">
              {{ app.entities[0]?.entityName }} · {{ app.entities[0]?.fields?.length || 0 }} 字段 ·
              {{ recordCount }} 条数据
            </div>
          </div>
        </div>
      </div>

      <div class="ya-row" style="gap: 8px">
        <button class="ya-btn ya-btn-ghost ya-btn-sm" title="导出应用配置（含数据）" @click="$emit('export')">
          📤 导出配置
        </button>
        <button class="ya-btn ya-btn-ghost ya-btn-sm" title="历史版本" @click="$emit('history')">🕘 版本</button>
        <button class="ya-btn ya-btn-ghost ya-btn-sm danger" title="删除该应用" @click="$emit('remove')">
          🗑️ 删除应用
        </button>
      </div>
    </div>
  </header>
</template>

<script setup>
defineProps({
  app: { type: Object, required: true },
  recordCount: { type: Number, default: 0 },
})

defineEmits(['back', 'export', 'remove', 'history'])
</script>

<style scoped>
.back {
  font-weight: 600;
}

.divider-v {
  width: 1px;
  height: 22px;
  background: var(--border);
}

.app-id {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.app-emoji {
  width: 32px;
  height: 32px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  font-size: 16px;
}

.app-title {
  font-size: 14.5px;
  font-weight: 680;
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-sub {
  font-size: 11.5px;
  color: var(--text-muted);
}

.danger:hover {
  color: var(--danger-600);
  border-color: color-mix(in srgb, var(--danger-500) 40%, transparent);
  background: var(--danger-50);
}

@media (max-width: 860px) {
  .app-sub {
    display: none;
  }
  .back {
    padding: 0 8px;
  }
}
</style>
