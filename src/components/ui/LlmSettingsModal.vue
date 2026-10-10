<template>
  <BaseModal
    v-model="open"
    icon="🧠"
    title="AI 生成引擎设置"
    subtitle="不配置也能用：系统内置规则引擎可离线完成需求理解与 Spec 生成；配置后将切换为真实大模型对话生成。"
    width="640px"
  >
    <div class="form">
      <div class="ya-note ya-note-info">
        <span>🔒</span>
        <span>接口地址、密钥仅保存在你本机的浏览器存储中，不会上传到任何服务器；调用时由浏览器直接请求你填写的地址。</span>
      </div>

      <label class="row-toggle">
        <div>
          <div class="row-title">启用大模型生成</div>
          <div class="row-sub">关闭时使用内置规则引擎（离线可用）</div>
        </div>
        <button class="ya-switch" :data-on="config.enabled" @click="config.enabled = !config.enabled" />
      </label>

      <div class="ya-field">
        <label class="ya-label">接口地址（OpenAI 兼容）</label>
        <input v-model="config.baseUrl" class="ya-input" placeholder="https://api.deepseek.com/v1" />
        <p class="ya-help">支持 DeepSeek / OpenAI / 通义 / 本地 Ollama（http://localhost:11434/v1）等兼容接口</p>
      </div>

      <div class="grid2">
        <div class="ya-field">
          <label class="ya-label">模型名称</label>
          <input v-model="config.model" class="ya-input" placeholder="deepseek-chat" />
        </div>
        <div class="ya-field">
          <label class="ya-label">温度（0~1）</label>
          <input v-model.number="config.temperature" class="ya-input" type="number" min="0" max="1" step="0.1" />
        </div>
      </div>

      <div class="ya-field">
        <label class="ya-label">API Key</label>
        <div class="ya-row" style="gap: 8px">
          <input
            v-model="config.apiKey"
            class="ya-input"
            :type="showKey ? 'text' : 'password'"
            placeholder="sk-..."
            autocomplete="off"
          />
          <button class="ya-btn ya-btn-ghost ya-btn-sm" @click="showKey = !showKey">
            {{ showKey ? '隐藏' : '显示' }}
          </button>
        </div>
      </div>

      <label class="row-toggle small">
        <div>
          <div class="row-title">流式输出</div>
          <div class="row-sub">逐字显示模型回复，体验更接近对话</div>
        </div>
        <button class="ya-switch" :data-on="config.stream" @click="config.stream = !config.stream" />
      </label>

      <div v-if="testResult" class="ya-note" :class="testOk ? 'ya-note-ok' : 'ya-note-danger'">
        <span>{{ testOk ? '✅' : '⛔' }}</span>
        <span>{{ testResult }}</span>
      </div>
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

const config = computed({
  get: () => settings.llm,
  set: (v) => settings.updateLlm(v),
})

async function runTest() {
  testing.value = true
  testResult.value = ''
  try {
    const reply = await testConnection(settings.llm)
    testOk.value = true
    testResult.value = `连接成功，模型回复：${reply}`
  } catch (e) {
    testOk.value = false
    testResult.value = `连接失败：${e?.message || e}`
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

.grid2 {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--space-4);
}

.row-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  cursor: pointer;
}

.row-title {
  font-size: 13.5px;
  font-weight: 620;
}

.row-sub {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 2px;
}
</style>
