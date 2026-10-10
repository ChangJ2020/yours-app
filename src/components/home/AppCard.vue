<template>
  <article class="app-card" :data-new="highlight" @click="$emit('open', app.appId)">
    <div class="card-top">
      <div class="app-icon">{{ app.icon || '🧩' }}</div>
      <div class="ya-grow">
        <h3 class="app-name">{{ app.appName }}</h3>
        <div class="ya-row" style="gap: 6px; margin-top: 4px; flex-wrap: wrap">
          <span class="ya-badge ya-badge-brand ya-badge-mono">v{{ app.version }}</span>
          <span class="ya-badge">{{ app.entities[0]?.fields?.length || 0 }} 字段</span>
          <span class="ya-badge">{{ app.pages?.length || 0 }} 页面</span>
        </div>
      </div>
      <span v-if="highlight" class="new-tag">NEW</span>
    </div>

    <p class="app-desc">{{ app.description || '暂无描述' }}</p>

    <div class="card-foot">
      <div class="meta">
        <span class="count"><b>{{ count }}</b> 条记录</span>
        <span class="dot">·</span>
        <span class="ya-muted">{{ timeAgo(app.updatedAt) }}更新</span>
      </div>
      <div class="actions" @click.stop>
        <button class="ya-btn ya-btn-quiet ya-btn-sm" title="导出应用配置" @click="$emit('export', app)">📤</button>
        <button class="ya-btn ya-btn-quiet ya-btn-sm danger" title="删除应用" @click="$emit('remove', app)">🗑️</button>
        <button class="ya-btn ya-btn-primary ya-btn-sm" @click="$emit('open', app.appId)">进入使用 →</button>
      </div>
    </div>
  </article>
</template>

<script setup>
import { timeAgo } from '@/utils/format.js'

defineProps({
  app: { type: Object, required: true },
  count: { type: Number, default: 0 },
  highlight: { type: Boolean, default: false },
})

defineEmits(['open', 'export', 'remove'])
</script>

<style scoped>
.app-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  cursor: pointer;
  transition: all var(--dur) var(--ease-out);
}

.app-card:hover {
  transform: translateY(-3px);
  border-color: var(--brand-300);
  box-shadow: var(--shadow-md);
}

.app-card[data-new='true'] {
  border-color: var(--brand-400);
  box-shadow: var(--shadow-brand);
  animation: ya-pulse-ring 2.4s infinite;
}

.card-top {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.app-icon {
  width: 42px;
  height: 42px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 12px;
  font-size: 20px;
  background: linear-gradient(135deg, var(--brand-50), color-mix(in srgb, var(--accent-400) 22%, transparent));
  border: 1px solid var(--border);
}

.app-name {
  font-size: 15px;
  font-weight: 680;
  line-height: 1.35;
}

.new-tag {
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.6px;
  color: #fff;
  background: linear-gradient(135deg, var(--brand-600), var(--accent-500));
  padding: 2px 7px;
  border-radius: var(--radius-full);
}

.app-desc {
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 40px;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  flex-wrap: wrap;
}

.meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-muted);
}

.count b {
  color: var(--brand-600);
  font-size: 13px;
}

.dot {
  opacity: 0.4;
}

.actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.danger:hover {
  color: var(--danger-600);
  background: var(--danger-50);
}
</style>
