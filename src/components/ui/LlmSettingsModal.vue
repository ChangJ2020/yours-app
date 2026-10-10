<template>
  <BaseModal
    v-model="open"
    icon="🧠"
    title="AI 对话引擎设置"
    subtitle="配置 OpenAI 兼容接口后，每次对话都会真实调用模型；不配置则使用内置规则引擎（离线可用）。"
    width="660px"
  >
    <div class="form">
      <!-- 当前生效状态 -->
      <div class="status-card" :data-mode="settings.aiMode ? 'ai' : 'local'">
        <div class="ya-row-between">
          <div class="ya-row" style="gap: 10px">
            <span class="status-dot" />
            <div>
              <div class="status-title">
                {{ settings.aiMode ? `AI 对话已启用 · ${settings.effectiveLlm.model}` : '当前使用内置引擎（不调用模型）' }}
              </div>
              <div class="status-sub">
                生效配置来源：接口地址 {{ sourceLabel(settings.effectiveLlm.baseUrlSource) }} · Key
                {{ sourceLabel(settings.effectiveLlm.apiKeySource) }}
                <template v-if="settings.keyFingerprint"> · {{ settings.keyFingerprint }}</template>
              </div>
            </div>
          </div>
          <button class="ya-switch" :data-on="settings.aiMode" @click="toggleAi" />
        </div>
      </div>

      <!-- 环境变量状态 -->
      <div class="ya-note" :class="settings.envInfo.available ? 'ya-note-ok' : 'ya-note-info'">
        <span>{{ settings.envInfo.available ? '✅' : 'ℹ️' }}</span>
        <span v-if="settings.envInfo.available">
          已从环境变量（<code>.env.local</code>）读取配置：<b>{{ settings.envInfo.model }}</b> ·
          {{ settings.envInfo.baseUrl }} · Key {{ settings.envInfo.keyFingerprint }}。
          环境变量优先级最高，会覆盖下方手工填写的值。
        </span>
        <span v-else>
          未检测到环境变量配置。可在工程根目录新建 <code>.env.local</code> 写入
          <code>VITE_YA_LLM_BASE_URL / VITE_YA_LLM_MODEL / VITE_YA_LLM_API_KEY</code>（可参考
          <code>.env.example</code>），或直接在下方填写。
        </span>
      </div>

      <div class="grid2">
        <div class="ya-field">
          <label class="ya-label">
            接口地址（OpenAI 兼容）
            <span v-if="settings.effectiveLlm.baseUrlSource === 'env'" class="ya-badge ya-badge-ok">来自环境变量</span>
          </label>
          <input
            v-model="llm.baseUrl"
            class="ya-input"
            :disabled="settings.effectiveLlm.baseUrlSource === 'env'"
            placeholder="https://api.deepseek.com/v1"
          />
          <p class="ya-help">支持 DeepSeek / OpenAI / 通义 / 本地 Ollama（http://localhost:11434/v1）</p>
        </div>
        <div class="ya-field">
          <label class="ya-label">
            模型名称
            <span v-if="settings.effectiveLlm.model && settings.envInfo.available" class="ya-badge ya-badge-ok">
              来自环境变量
            </span>
          </label>
          <input v-model="llm.model" class="ya-input" :disabled="settings.envInfo.available" placeholder="deepseek-chat" />
        </div>
      </div>

      <div class="ya-field">
        <label class="ya-label">
          API Key
          <span v-if="settings.effectiveLlm.apiKeySource === 'env'" class="ya-badge ya-badge-ok">
            来自环境变量（不写入本地存储）
          </span>
        </label>
        <div class="ya-row" style="gap: 8px">
          <input
            v-if="settings.effectiveLlm.apiKeySource !== 'env'"
            v-model="llm.apiKey"
            class="ya-input"
            :type="showKey ? 'text' : 'password'"
            placeholder="sk-..."
            autocomplete="off"
          />
          <input v-else class="ya-input" :value="settings.keyFingerprint" disabled />
          <button
            v-if="settings.effectiveLlm.apiKeySource !== 'env'"
            class="ya-btn ya-btn-ghost ya-btn-sm"
            @click="showKey = !showKey"
          >
            {{ showKey ? '隐藏' : '显示' }}
          </button>
        </div>
      </div>

      <div class="grid2">
        <div class="ya-field">
          <label class="ya-label">温度（0~1）</label>
          <input v-model.number="llm.temperature" class="ya-input" type="number" min="0" max="1" step="0.1" />
        </div>
        <label class="row-toggle small">
          <div>
            <div class="row-title">流式输出</div>
            <div class="row-sub">逐字显示模型回复</div>
          </div>
          <button class="ya-switch" :data-on="llm.stream" @click="llm.stream = !llm.stream" />
        </label>
      </div>

      <div v-if="testResult" class="ya-note" :class="testOk ? 'ya-note-ok' : 'ya-note-danger'">
        <span>{{ testOk ? '✅' : '⛔' }}</span>
        <span>{{ testResult }}</span>
      </div>

      <details class="advanced">
        <summary>🔐 安全说明（点开看）</summary>
        <p>
          本项目是纯前端应用：填在浏览器里的 Key 只存于本机 localStorage；写在
          <code>.env.local</code> 里的 Key 会在构建时注入前端产物。因此 —— 本机自用没问题，
          <b>请不要把带 Key 的 dist/ 发布到公网</b>。若将来要公开部署，应改为请求自建后端代理，由后端保管密钥。
        </p>
      </details>
    </div>

    <template #footer>
      <button class="ya-btn ya-btn-quiet" @click="reset">恢复默认</button>
      <button class="ya-btn ya-btn-ghost" :disabled="testing" @click="runTest">
        {{ testing ? '测试中…' : '测试连接' }}
      </button>
      <button class="ya-btn ya-btn-primary" @click="open = false">完成</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed, ref } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import { testConnection } from '@/engine/llmClient.js'
import { useSettingsStore } from '@/stores/settings.js'

const open = defineModel({ type: Boolean, default: false })

const settings = useSettingsStore()
const showKey = ref(false)
const testing = ref(false)
const testResult = ref('')
const testOk = ref(false)

/** 直接绑定 store 里的 llm（不含环境变量注入的 Key，避免把 env 密钥写回本地存储） */
const llm = computed(() => settings.llm)

function sourceLabel(source) {
  return { env: '环境变量', local: '本地填写', none: '未配置' }[source] || '未配置'
}

function toggleAi() {
  settings.setAiMode(!settings.aiMode)
}

async function runTest() {
  testing.value = true
  testResult.value = ''
  try {
    const { reply, latencyMs, model } = await testConnection(settings.llm)
    testOk.value = true
    testResult.value = `连接成功（${model} · ${(latencyMs / 1000).toFixed(2)}s）：${reply}`
  } catch (e) {
    testOk.value = false
    testResult.value = `连接失败：${e?.message || e}${e?.kind ? `（${settings.errorHint(e.kind)}）` : ''}`
  } finally {
    testing.value = false
  }
}

function reset() {
  settings.resetLlm()
  testResult.value = ''
}
</script>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.status-card {
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-subtle);
}

.status-card[data-mode='ai'] {
  border-color: color-mix(in srgb, var(--ok-500) 40%, transparent);
  background: color-mix(in srgb, var(--ok-50) 60%, var(--bg-elevated));
}

.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--text-muted);
  flex: none;
}

.status-card[data-mode='ai'] .status-dot {
  background: var(--ok-500);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok-500) 20%, transparent);
}

.status-title {
  font-size: 13.5px;
  font-weight: 650;
}

.status-sub {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 3px;
}

.grid2 {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: var(--space-4);
}

.row-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  cursor: pointer;
}

.row-toggle.small {
  padding: 8px 12px;
}

.row-title {
  font-size: 13px;
  font-weight: 620;
}

.row-sub {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 2px;
}

code {
  font-family: var(--font-mono);
  font-size: 11.5px;
  background: var(--bg-sunken);
  padding: 1px 5px;
  border-radius: 4px;
}

.advanced {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  background: var(--bg-subtle);
}

.advanced summary {
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 620;
  color: var(--text-secondary);
}

.advanced p {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.7;
  margin-top: 8px;
}
</style>
