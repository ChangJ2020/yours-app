<template>
  <div class="studio">
    <!-- 进度指示条 -->
    <div class="progress-card">
      <StepIndicator :steps="chat.steps" />
      <div class="progress-foot">
        <span class="ya-badge" :class="chat.usingLlm ? 'ya-badge-brand' : 'ya-badge-info'">
          {{ chat.usingLlm ? '🤖 ' + modeLabel : '⚙️ 内置生成引擎' }}
        </span>
        <span v-if="chat.modeNote" class="mode-note">{{ chat.modeNote }}</span>
      </div>
    </div>

    <!-- 消息流 -->
    <div ref="scrollEl" class="stream">
      <ChatBubble v-for="msg in chat.messages" :key="msg.id" :message="msg" />

      <div v-if="chat.thinking && !chat.streamingText" class="thinking">
        <div class="avatar">YA</div>
        <div class="dots"><span /><span /><span /></div>
        <span class="thinking-text">正在梳理你的业务需求…</span>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="composer">
      <div v-if="chat.featureList.length && chat.stepKey !== 'running'" class="chips">
        <button
          v-for="(s, i) in chat.suggestions"
          :key="i"
          class="chip"
          :disabled="chat.thinking"
          @click="submit(s.value)"
        >
          {{ s.label }}
        </button>
      </div>

      <div class="input-row">
        <textarea
          ref="inputEl"
          v-model="text"
          class="ya-textarea composer-input"
          :placeholder="placeholder"
          rows="2"
          :disabled="chat.thinking"
          @keydown.enter.exact.prevent="submit()"
        />
        <div class="input-actions">
          <button
            class="ya-btn ya-btn-ghost ya-btn-icon"
            title="清空对话，重新开始"
            :disabled="chat.thinking"
            @click="$emit('reset')"
          >
            ♻️
          </button>
          <button class="ya-btn ya-btn-primary" :disabled="chat.thinking || !text.trim()" @click="submit()">
            {{ chat.thinking ? '思考中…' : '发送' }}
          </button>
        </div>
      </div>

      <div class="foot">
        <span class="hint">
          <span class="ya-kbd">Enter</span> 发送 · <span class="ya-kbd">Shift+Enter</span> 换行
        </span>
        <button
          v-if="chat.canGenerate"
          class="ya-btn ya-btn-success"
          :disabled="chat.thinking"
          @click="$emit('generate')"
        >
          🚀 {{ chat.stepKey === 'features' ? '功能没问题，查看详细规格' : '确认并生成应用' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import ChatBubble from './ChatBubble.vue'
import StepIndicator from './StepIndicator.vue'

const props = defineProps({
  chat: { type: Object, required: true },
  modeLabel: { type: String, default: '' },
})

const emit = defineEmits(['send', 'generate', 'reset'])

const text = ref('')
const scrollEl = ref(null)
const inputEl = ref(null)

const placeholder = computed(() => {
  switch (props.chat.stepKey) {
    case 'describe':
      return '用一句话描述你想要的 App，例如：我需要一个记录员工工时和加班的工具…'
    case 'features':
      return '增删改功能，例如：增加月度优秀员工功能 / 去掉审核步骤；没问题就回复「可以，继续」'
    case 'spec':
      return '需要调整字段或页面就继续说；确认无误点击下方「确认并生成应用」'
    default:
      return '应用已生成，可继续描述新的需求'
  }
})

function submit(preset) {
  const value = (preset ?? text.value).trim()
  if (!value || props.chat.thinking) return
  text.value = ''
  emit('send', value)
}

function scrollToBottom() {
  nextTick(() => {
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(() => [props.chat.messages.length, props.chat.streamingText, props.chat.thinking], scrollToBottom, {
  immediate: true,
})

defineExpose({ focus: () => inputEl.value?.focus(), submit })
</script>

<style scoped>
.studio {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.progress-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px 20px 12px;
  box-shadow: var(--shadow-xs);
}

.progress-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  flex-wrap: wrap;
}

.mode-note {
  font-size: 11.5px;
  color: var(--text-muted);
}

.stream {
  min-height: 300px;
  max-height: 46vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  scroll-behavior: smooth;
}

.thinking {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  font-family: var(--font-mono);
  background: linear-gradient(135deg, var(--brand-600), var(--accent-500));
  color: #fff;
}

.dots {
  display: inline-flex;
  gap: 5px;
}

.dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-500);
  animation: ya-blink 1.2s infinite;
}

.dots span:nth-child(2) {
  animation-delay: 0.15s;
}
.dots span:nth-child(3) {
  animation-delay: 0.3s;
}

.thinking-text {
  font-size: 12.5px;
  color: var(--text-muted);
}

.composer {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.chip {
  font-size: 12px;
  padding: 5px 11px;
  border-radius: var(--radius-full);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  transition: all var(--dur) var(--ease-out);
}

.chip:hover:not(:disabled) {
  border-color: var(--brand-400);
  color: var(--brand-600);
  background: var(--brand-50);
  transform: translateY(-1px);
}

.input-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.composer-input {
  min-height: 54px;
  max-height: 160px;
  border: none;
  background: transparent;
  padding: 6px 4px;
  font-size: 14px;
}

.composer-input:focus {
  box-shadow: none;
}

.input-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-bottom: 2px;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}

.hint {
  font-size: 11.5px;
  color: var(--text-muted);
}
</style>
