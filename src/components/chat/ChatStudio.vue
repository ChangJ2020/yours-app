<template>
  <div class="studio">
    <!-- 进度指示条 + 引擎状态 -->
    <div class="progress-card">
      <StepIndicator :steps="chat.steps" />
      <div class="progress-foot">
        <button
          class="mode-chip"
          :data-mode="aiMode ? 'ai' : 'local'"
          :title="aiMode ? '当前由真实大模型对话生成，点击切回内置引擎' : '当前使用内置规则引擎（离线），点击启用 AI 对话'"
          @click="$emit('toggle-mode', !aiMode)"
        >
          <span class="mode-dot" />
          {{ aiMode ? `AI 对话 · ${modelName}` : '内置引擎模式' }}
          <span class="mode-switch">{{ aiMode ? '切回内置' : '启用 AI' }}</span>
        </button>

        <span v-if="aiStatusText" class="ai-status" :data-state="chat.aiStatus">{{ aiStatusText }}</span>
        <span v-else-if="chat.modeNote" class="mode-note">{{ chat.modeNote }}</span>

        <button v-if="!aiMode" class="ya-btn ya-btn-quiet ya-btn-sm" @click="$emit('open-settings')">
          ⚙️ 配置 AI 接口
        </button>
      </div>
    </div>

    <!-- 模型调用失败提示（不再静默回退，问题可见且可操作） -->
    <div v-if="chat.lastError" class="ai-error">
      <span class="err-icon">⛔</span>
      <div class="ya-grow">
        <div class="err-title">{{ errorTitle }}</div>
        <div class="err-msg">{{ chat.lastError.message }}</div>
        <div class="err-hint">💡 {{ chat.lastError.hint }}</div>
      </div>
      <div class="err-actions">
        <button class="ya-btn ya-btn-ghost ya-btn-sm" :disabled="chat.thinking" @click="$emit('retry')">🔄 重试</button>
        <button class="ya-btn ya-btn-quiet ya-btn-sm" :disabled="chat.thinking" @click="$emit('fallback-local')">
          用内置引擎继续
        </button>
        <button class="ya-btn ya-btn-quiet ya-btn-sm" @click="$emit('open-settings')">⚙️ 检查配置</button>
      </div>
    </div>

    <!-- 消息流 -->
    <div ref="scrollEl" class="stream">
      <ChatBubble v-for="msg in chat.messages" :key="msg.id" :message="msg" />

      <div v-if="chat.thinking" class="thinking">
        <div class="avatar">YA</div>
        <div class="dots"><span /><span /><span /></div>
        <span class="thinking-text">{{ aiStatusText || '正在梳理你的业务需求…' }}</span>
        <button class="ya-btn ya-btn-quiet ya-btn-sm" @click="$emit('stop')">■ 停止</button>
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
            {{ chat.thinking ? '生成中…' : '发送' }}
          </button>
        </div>
      </div>

      <div class="foot">
        <span class="hint">
          <span class="ya-kbd">Enter</span> 发送 · <span class="ya-kbd">Shift+Enter</span> 换行 ·
          {{ aiMode ? '每轮均调用真实模型' : '当前不调用模型' }}
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
  aiMode: { type: Boolean, default: false },
  modelName: { type: String, default: '' },
})

const emit = defineEmits(['send', 'generate', 'reset', 'stop', 'retry', 'fallback-local', 'toggle-mode', 'open-settings'])

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

const aiStatusText = computed(() => {
  if (!props.chat.thinking) return ''
  switch (props.chat.aiStatus) {
    case 'requesting':
      return '正在请求模型…'
    case 'streaming':
      return '模型正在流式输出…'
    case 'parsing':
      return '正在解析模型返回的 Spec…'
    default:
      return '正在思考…'
  }
})

const errorTitle = computed(() => {
  const kind = props.chat.lastError?.kind
  return (
    {
      config: '模型配置不完整',
      auth: 'API Key 鉴权失败',
      rate_limit: '触发限流或额度不足',
      network: '网络或跨域问题',
      server: '模型服务端异常',
      empty: '模型返回空内容',
      aborted: '已停止生成',
    }[kind] || '模型调用失败'
  )
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

.mode-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border);
  background: var(--bg-subtle);
  color: var(--text-secondary);
  transition: all var(--dur) var(--ease-out);
}

.mode-chip:hover {
  border-color: var(--brand-400);
}

.mode-chip[data-mode='ai'] {
  background: var(--brand-50);
  border-color: color-mix(in srgb, var(--brand-500) 40%, transparent);
  color: var(--brand-700);
}

:root[data-theme='dark'] .mode-chip[data-mode='ai'] {
  color: var(--brand-300);
}

.mode-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
}

.mode-chip[data-mode='ai'] .mode-dot {
  background: var(--ok-500);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok-500) 22%, transparent);
}

.mode-switch {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.62;
  border-left: 1px solid currentColor;
  padding-left: 7px;
}

.ai-status {
  font-size: 11.5px;
  color: var(--brand-600);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.ai-status::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-500);
  animation: ya-blink 1s infinite;
}

.mode-note {
  font-size: 11.5px;
  color: var(--text-muted);
}

.ai-error {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--danger-50);
  border: 1px solid color-mix(in srgb, var(--danger-500) 30%, transparent);
  animation: ya-fade-up 220ms var(--ease-out) both;
}

.err-icon {
  font-size: 15px;
}

.err-title {
  font-size: 13px;
  font-weight: 680;
  color: var(--danger-600);
}

.err-msg {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-top: 3px;
  line-height: 1.55;
  word-break: break-word;
}

.err-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 5px;
}

.err-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: none;
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

@media (max-width: 720px) {
  .err-actions {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>
