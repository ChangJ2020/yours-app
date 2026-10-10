<template>
  <div class="bubble" :data-role="message.role">
    <div class="avatar" :data-role="message.role">
      <span v-if="message.role === 'assistant'">YA</span>
      <span v-else>你</span>
    </div>
    <div class="body">
      <div class="meta">
        <span class="who">{{ message.role === 'assistant' ? 'YA 产品架构师' : '我' }}</span>
        <span class="time">{{ time }}</span>
        <span v-if="message.streaming" class="ya-badge ya-badge-brand">生成中…</span>
        <span v-else-if="message.mode === 'ai'" class="ya-badge ya-badge-ok ya-badge-mono" :title="tokenTitle">
          🤖 {{ message.model || 'AI' }}{{ latencyText }}
        </span>
        <span v-else-if="message.mode === 'local'" class="ya-badge" title="由内置规则引擎生成，未调用模型">
          ⚙️ 内置引擎
        </span>
        <span v-if="message.errorKind" class="ya-badge ya-badge-danger">调用失败</span>
      </div>
      <div class="content" :data-tone="message.tone || 'default'">
        <MarkdownText :text="message.content" />
        <span v-if="message.streaming" class="caret" />
      </div>
      <p v-if="message.note" class="note">ℹ️ {{ message.note }}</p>
      <div v-if="message.role === 'assistant' && actions" class="actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import MarkdownText from '@/components/ui/MarkdownText.vue'

const props = defineProps({
  message: { type: Object, required: true },
  actions: { type: Boolean, default: false },
})

const time = computed(() => {
  const d = new Date(props.message.at || Date.now())
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

const latencyText = computed(() => {
  const ms = props.message.latencyMs
  if (!ms) return ''
  return ` · ${(ms / 1000).toFixed(1)}s`
})

const tokenTitle = computed(() => {
  const u = props.message.usage
  if (!u) return '由真实模型生成（未返回 token 统计）'
  const total = u.total_tokens || (u.prompt_tokens || 0) + (u.completion_tokens || 0)
  return `由 ${props.message.model || '模型'} 生成 · 输入 ${u.prompt_tokens ?? '-'} / 输出 ${u.completion_tokens ?? '-'} / 合计 ${total || '-'} tokens`
})
</script>

<style scoped>
.bubble {
  display: flex;
  gap: 12px;
  animation: ya-fade-up 260ms var(--ease-out) both;
}

.bubble[data-role='user'] {
  flex-direction: row-reverse;
}

.avatar {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  font-family: var(--font-mono);
}

.avatar[data-role='assistant'] {
  background: linear-gradient(135deg, var(--brand-600), var(--accent-500));
  color: #fff;
  box-shadow: var(--shadow-brand);
}

.avatar[data-role='user'] {
  background: var(--bg-sunken);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

.body {
  min-width: 0;
  max-width: 86%;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.bubble[data-role='user'] .body {
  align-items: flex-end;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-muted);
}

.who {
  font-weight: 620;
  color: var(--text-secondary);
}

.content {
  padding: 12px 15px;
  border-radius: 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-xs);
}

.bubble[data-role='assistant'] .content {
  border-top-left-radius: 4px;
}

.bubble[data-role='user'] .content {
  background: linear-gradient(135deg, var(--brand-600), var(--brand-500));
  color: #fff;
  border-color: transparent;
  border-top-right-radius: 4px;
  box-shadow: var(--shadow-brand);
}

.bubble[data-role='user'] .content :deep(p),
.bubble[data-role='user'] .content :deep(strong) {
  color: #fff;
}

.content[data-tone='success'] {
  border-color: color-mix(in srgb, var(--ok-500) 35%, transparent);
  background: color-mix(in srgb, var(--ok-50) 70%, var(--bg-elevated));
}

.content[data-tone='error'] {
  border-color: color-mix(in srgb, var(--danger-500) 35%, transparent);
  background: color-mix(in srgb, var(--danger-50) 70%, var(--bg-elevated));
}

.note {
  font-size: 11.5px;
  color: var(--text-muted);
  padding-left: 2px;
}

.caret {
  display: inline-block;
  width: 7px;
  height: 14px;
  margin-left: 3px;
  vertical-align: text-bottom;
  background: var(--brand-500);
  animation: ya-blink 1.1s infinite;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}
</style>
