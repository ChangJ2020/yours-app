<template>
  <div class="page">
    <!-- 顶栏 -->
    <header class="ya-topbar">
      <div class="ya-shell ya-topbar-inner">
        <div class="ya-logo">
          <span class="ya-logo-mark">YA</span>
          <span>
            Yours App
            <span class="ya-logo-sub">自然语言零代码应用生成工作台</span>
          </span>
        </div>

        <div class="ya-row" style="gap: 8px">
          <button
            class="mode-pill"
            :data-mode="settings.aiMode ? 'ai' : 'local'"
            :title="
              settings.aiMode
                ? `当前使用 ${settings.effectiveLlm.model} 生成，点击切回内置引擎`
                : '当前使用内置规则引擎，点击启用 AI 对话'
            "
            @click="onToggleMode(!settings.aiMode)"
          >
            <span class="pill-dot" />
            {{ settings.aiMode ? `AI 对话 · ${settings.effectiveLlm.model}` : '内置引擎模式' }}
          </button>
          <button class="ya-btn ya-btn-quiet ya-btn-icon" title="AI 引擎设置" @click="showSettings = true">⚙️</button>
          <button
            class="ya-btn ya-btn-quiet ya-btn-icon"
            :title="settings.theme === 'dark' ? '切换浅色主题' : '切换深色主题'"
            @click="settings.toggleTheme()"
          >
            {{ settings.theme === 'dark' ? '☀️' : '🌙' }}
          </button>
          <button class="ya-btn ya-btn-quiet ya-btn-icon" title="使用指南" @click="showHelp = true">❓</button>
          <button class="ya-btn ya-btn-ghost ya-btn-sm" title="清空本地全部数据" @click="showReset = true">
            清空重置
          </button>
        </div>
      </div>
    </header>

    <main class="ya-shell content">
      <!-- 标题区 -->
      <section class="hero">
        <div>
          <h1 class="hero-title">
            说出你的业务诉求，<span class="grad">立刻得到一个能用的应用</span>
          </h1>
          <p class="hero-sub">
            不用懂编程，也不用拖拽配置。四步对话：需求描述 → 功能清单 → 详细规格 → 生成并运行。
            所有数据保存在你自己的浏览器里，无需登录。
          </p>
        </div>
        <div class="hero-stats">
          <div class="hs">
            <b>{{ apps.apps.length }}</b>
            <span>已生成应用</span>
          </div>
          <div class="hs">
            <b>{{ apps.totalRecords }}</b>
            <span>本地记录数</span>
          </div>
          <div class="hs">
            <b>{{ formatBytes(usage.usage) }}</b>
            <span>本地占用</span>
          </div>
        </div>
      </section>

      <!-- 生成工作台 -->
      <section class="workbench">
        <div class="wb-main">
          <ChatStudio
            ref="studioRef"
            :chat="chat"
            :ai-mode="settings.aiMode"
            :model-name="settings.effectiveLlm.model"
            @send="onSend"
            @generate="onGenerate"
            @reset="onReset"
            @stop="onStop"
            @retry="onRetry"
            @fallback-local="onFallbackLocal"
            @toggle-mode="onToggleMode"
            @open-settings="showSettings = true"
          />
        </div>

        <aside class="wb-side">
          <ChatPanel
            v-if="chat.featureList.length"
            icon="🧩"
            title="功能清单"
            :subtitle="`${chat.featureList.length} 项 · 可继续用中文增删改`"
            tone="brand"
          >
            <ul class="feat-list">
              <li v-for="(f, i) in chat.featureList" :key="f.id" class="feat-item">
                <span class="feat-icon">{{ f.icon || '📌' }}</span>
                <div>
                  <div class="feat-title">{{ i + 1 }}. {{ f.title }}</div>
                  <div class="feat-desc">{{ f.description }}</div>
                </div>
              </li>
            </ul>
          </ChatPanel>

          <ChatPanel
            v-if="chat.spec"
            icon="🧬"
            title="详细规格（Spec）"
            subtitle="字段与页面随功能清单实时联动"
          >
            <div class="spec-mini">
              <div class="spec-row">
                <span class="ya-badge ya-badge-mono">数据表</span>
                <b>{{ chat.spec.entities[0].entityName }}</b>
                <span class="ya-muted">{{ chat.spec.entities[0].fields.length }} 字段</span>
              </div>
              <div class="field-grid">
                <span v-for="f in chat.spec.entities[0].fields" :key="f.key" class="field-pill">
                  {{ f.label }}
                  <i>{{ FIELD_TYPE_MAP[f.type]?.label }}</i>
                </span>
              </div>
              <div class="spec-row">
                <span class="ya-badge ya-badge-mono">页面</span>
                <span v-for="p in chat.spec.pages" :key="p.pageId" class="page-pill">
                  {{ p.pageType === 'form' ? '📝' : '📊' }} {{ p.pageTitle }}
                </span>
              </div>
            </div>
            <button
              v-if="chat.stepKey !== 'running'"
              class="ya-btn ya-btn-success"
              style="width: 100%; margin-top: 12px"
              :disabled="chat.thinking"
              @click="onGenerate"
            >
              🚀 {{ chat.stepKey === 'features' ? '功能没问题，查看详细规格' : '确认并生成应用' }}
            </button>
          </ChatPanel>

          <ChatPanel icon="💡" title="不知道怎么描述？" subtitle="点一下直接试用示例需求">
            <div class="idea-grid">
              <button v-for="idea in quickIdeas" :key="idea.label" class="idea" @click="useIdea(idea.text)">
                <span class="idea-icon">{{ idea.icon }}</span>
                <span>{{ idea.label }}</span>
              </button>
            </div>
          </ChatPanel>
        </aside>
      </section>

      <!-- 已生成应用 -->
      <section class="hub">
        <div class="hub-head">
          <div>
            <h2 class="ya-section-title">
              🗂️ 已生成的应用 <small>My Apps · 点击卡片进入使用与迭代</small>
            </h2>
          </div>
          <div class="ya-row">
            <button class="ya-btn ya-btn-ghost ya-btn-sm" :disabled="apps.loading" @click="apps.refresh()">
              {{ apps.loading ? '刷新中…' : '🔄 刷新' }}
            </button>
            <button class="ya-btn ya-btn-ghost ya-btn-sm" @click="triggerImport">📥 导入配置</button>
            <input ref="fileInput" type="file" accept="application/json" style="display: none" @change="onImportFile" />
          </div>
        </div>

        <div v-if="apps.apps.length" class="app-grid">
          <AppCard
            v-for="app in apps.apps"
            :key="app.appId"
            :app="app"
            :count="apps.countOf(app.appId)"
            :highlight="apps.lastBuiltId === app.appId"
            @open="openApp"
            @export="exportApp"
            @remove="askRemove"
          />
        </div>

        <div v-else class="ya-card ya-empty">
          <div class="ya-empty-icon">🧩</div>
          <div style="font-weight: 650; color: var(--text-secondary)">这里还很空</div>
          <div style="font-size: 13px; margin-top: 6px">
            在上面输入你的业务需求，生成第一个应用后，它会出现在这里
          </div>
        </div>
      </section>

      <footer class="foot">
        <span>Yours App (YA) · 配置驱动引擎 · 免登录 · 数据全部保存在本地浏览器</span>
        <span class="ya-muted">Spec v{{ APP_SPEC_VERSION }}</span>
      </footer>
    </main>

    <!-- 弹窗 -->
    <LlmSettingsModal v-model="showSettings" />

    <BaseModal v-model="showRemove" icon="⚠️" title="删除应用" subtitle="该操作不可撤销" width="520px">
      <div v-if="pendingRemove" class="remove-body">
        <p>
          即将删除应用「<b>{{ pendingRemove.appName }}</b>」v{{ pendingRemove.version }}，
          其 <b>{{ apps.countOf(pendingRemove.appId) }}</b> 条本地数据与历史版本快照将一并清除。
        </p>
        <div class="ya-note ya-note-warn">
          <span>💡</span>
          <span>如果只是想暂时不用，建议先「导出配置」做个备份（含全部数据）。</span>
        </div>
        <label class="ya-check" style="margin-top: 10px">
          <input v-model="exportBeforeRemove" type="checkbox" />
          删除前先导出备份
        </label>
      </div>
      <template #footer>
        <button class="ya-btn ya-btn-ghost" @click="showRemove = false">取消</button>
        <button class="ya-btn ya-btn-danger" @click="confirmRemove">确认删除</button>
      </template>
    </BaseModal>

    <BaseModal v-model="showReset" icon="🧹" title="清空本地数据" subtitle="重置为初始状态" width="520px">
      <div class="ya-stack">
        <p>将删除本机上全部应用、表单数据与版本快照，并重新植入一份演示数据（员工工时记录助手）。</p>
        <div class="ya-note ya-note-danger">
          <span>⚠️</span>
          <span>该操作不可恢复，请确认已导出需要保留的配置。</span>
        </div>
      </div>
      <template #footer>
        <button class="ya-btn ya-btn-ghost" @click="showReset = false">取消</button>
        <button class="ya-btn ya-btn-danger" @click="confirmReset">确认清空</button>
      </template>
    </BaseModal>

    <BaseModal v-model="showHelp" icon="❓" title="使用指南" width="680px">
      <div class="help">
        <div class="help-step">
          <span class="help-num">1</span>
          <div>
            <b>需求描述</b>
            <p>用日常语言说清楚要管什么业务，例如「我需要一个记录员工工时和加班的工具」。</p>
          </div>
        </div>
        <div class="help-step">
          <span class="help-num">2</span>
          <div>
            <b>功能清单对齐</b>
            <p>系统给出功能清单，你可以继续用中文增删改：「增加月度优秀员工功能」「去掉审核步骤」。</p>
          </div>
        </div>
        <div class="help-step">
          <span class="help-num">3</span>
          <div>
            <b>详细规格确认</b>
            <p>系统把功能细化成页面与字段（名称、类型、是否必填），确认后即可生成。</p>
          </div>
        </div>
        <div class="help-step">
          <span class="help-num">4</span>
          <div>
            <b>生成并运行</b>
            <p>应用立即可用：填报表单、明细表格、搜索筛选、导出 CSV。数据保存在本机浏览器。</p>
          </div>
        </div>
        <div class="help-step">
          <span class="help-num">5</span>
          <div>
            <b>二次迭代</b>
            <p>
              进入应用详情页，在「功能清单与 Spec 配置编辑」里改动，点击 <b>重新构建</b>
              ，版本号升级且历史数据无损迁移（删除的字段会进入归档区）。
            </p>
          </div>
        </div>
        <div class="ya-note ya-note-info">
          <span>🧠</span>
          <span>
            默认使用内置规则引擎，完全离线可用；在 ⚙️ 里填入任意 OpenAI 兼容接口（DeepSeek / OpenAI / 本地
            Ollama），即可切换为真实大模型生成。
          </span>
        </div>
      </div>
      <template #footer>
        <button class="ya-btn ya-btn-primary" @click="showHelp = false">我知道了</button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ChatStudio from '@/components/chat/ChatStudio.vue'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import AppCard from '@/components/home/AppCard.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import LlmSettingsModal from '@/components/ui/LlmSettingsModal.vue'
import { useAppsStore } from '@/stores/apps.js'
import { useChatStore } from '@/stores/chat.js'
import { useSettingsStore } from '@/stores/settings.js'
import { APP_SPEC_VERSION, FIELD_TYPE_MAP } from '@/engine/spec.js'
import { QUICK_IDEAS } from '@/engine/localEngine.js'
import { estimateUsage, STORE, dbBulkPut, resetAll } from '@/services/db.js'
import { buildDemoRecords, DEMO_SPEC, markSeeded, clearSeedFlag } from '@/services/demoData.js'
import { exportApp as exportAppPayload, importApp } from '@/services/storageService.js'
import { downloadFile, formatBytes } from '@/utils/format.js'
import { toast } from '@/composables/useToast.js'

const router = useRouter()
const apps = useAppsStore()
const chat = useChatStore()
const settings = useSettingsStore()

const studioRef = ref(null)
const usage = ref({ usage: 0, quota: 0 })
const quickIdeas = QUICK_IDEAS

const showSettings = ref(false)
const showHelp = ref(false)
const showReset = ref(false)
const showRemove = ref(false)
const pendingRemove = ref(null)
const exportBeforeRemove = ref(true)
const fileInput = ref(null)

onMounted(async () => {
  chat.reset()
  await seedIfNeeded()
  await apps.refresh()
  usage.value = await estimateUsage()
})

/** 首次打开植入演示数据，保证开箱可见效果 */
async function seedIfNeeded() {
  // 以「数据是否真的存在」为准，避免刷新标记与数据库状态不一致时白屏
  const existing = await apps.fetchOne(DEMO_SPEC.appId).catch(() => null)
  if (existing) {
    markSeeded()
    return
  }
  try {
    await apps.create(DEMO_SPEC)
    await dbBulkPut(STORE.RECORDS, buildDemoRecords())
    await apps.refresh()
    markSeeded()
    toast.info('已为你准备了一个演示应用「员工工时记录助手」，可直接进入体验', '欢迎使用 Yours App')
  } catch (e) {
    console.warn('演示数据植入失败', e)
  }
}

async function onSend(text) {
  const { created, error } = await chat.send(text)
  if (created) await afterCreated(created)
  if (error && !created) {
    // 错误详情已在对话区与气泡中展示，这里只做一次轻提示，避免重复打扰
    toast.error(error.hint || error.message, '模型调用失败')
  }
}

async function onRetry() {
  const { created, error } = await chat.retryLast()
  if (created) await afterCreated(created)
  if (!error) toast.info('已重试并成功')
}

async function onFallbackLocal() {
  await chat.fallbackToLocal()
  toast.info('已切换到内置引擎模式，后续对话不再调用模型')
}

function onStop() {
  chat.abortGeneration()
  toast.info('已请求停止生成')
}

function onToggleMode(next) {
  if (next && !settings.llmReady) {
    showSettings.value = true
    toast.warn('请先填写接口地址、模型名与 API Key', '需要先配置 AI 接口')
    return
  }
  settings.setAiMode(next)
  toast.ok(next ? `已启用 AI 对话（${settings.effectiveLlm.model}）` : '已切换到内置引擎模式')
}

async function onGenerate() {
  const spec = chat.confirmAndGenerate()
  if (spec) await afterCreated(spec)
}

async function afterCreated(spec) {
  const saved = await apps.create(spec)
  usage.value = await estimateUsage()
  toast.ok(`「${saved.appName}」已生成，可进入应用开始填报数据`, '构建成功')
}

function onReset() {
  chat.reset()
  toast.info('对话已重置，可以重新描述需求')
}

function useIdea(text) {
  studioRef.value?.submit(text)
}

function openApp(appId) {
  router.push({ name: 'app-detail', params: { appId } })
}

async function exportApp(app) {
  try {
    const payload = await exportAppPayload(app.appId, { includeRecords: true })
    downloadFile(`yours-app_${app.appName}.json`, JSON.stringify(payload, null, 2), 'application/json')
    toast.ok(`已导出「${app.appName}」配置与数据`)
  } catch (e) {
    toast.error(e?.message || '导出失败')
  }
}

function askRemove(app) {
  pendingRemove.value = app
  exportBeforeRemove.value = true
  showRemove.value = true
}

async function confirmRemove() {
  const app = pendingRemove.value
  if (!app) return
  try {
    if (exportBeforeRemove.value) await exportApp(app)
    const res = await apps.remove(app.appId)
    toast.ok(`已删除「${app.appName}」（含 ${res.removedRecords} 条数据）`)
  } catch (e) {
    toast.error(e?.message || '删除失败')
  } finally {
    showRemove.value = false
    pendingRemove.value = null
    usage.value = await estimateUsage()
  }
}

async function confirmReset() {
  try {
    await resetAll()
    clearSeedFlag()
    await apps.refresh()
    chat.reset()
    await seedIfNeeded()
    await apps.refresh()
    usage.value = await estimateUsage()
    toast.ok('本地数据已清空并恢复演示数据')
  } catch (e) {
    toast.error(e?.message || '清空失败')
  } finally {
    showReset.value = false
  }
}

function triggerImport() {
  fileInput.value?.click()
}

async function onImportFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const payload = JSON.parse(text)
    const spec = await importApp(payload)
    await apps.refresh()
    toast.ok(`已导入「${spec.appName}」`)
  } catch (e) {
    toast.error(`导入失败：${e?.message || e}`)
  } finally {
    event.target.value = ''
  }
}
</script>

<style scoped>
.page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.content {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding-top: var(--space-6);
  padding-bottom: var(--space-10);
  flex: 1;
}

.hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-6);
  flex-wrap: wrap;
}

.hero-title {
  font-size: 27px;
  font-weight: 750;
  letter-spacing: -0.4px;
  line-height: 1.35;
}

.grad {
  background: linear-gradient(120deg, var(--brand-600), var(--accent-500));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.hero-sub {
  margin-top: 8px;
  font-size: 13.5px;
  color: var(--text-muted);
  max-width: 640px;
  line-height: 1.7;
}

.hero-stats {
  display: flex;
  gap: var(--space-5);
  padding: 12px 18px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
}

/* 顶栏 AI 模式指示（可点击切换） */
.mode-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border);
  background: var(--bg-subtle);
  color: var(--text-secondary);
  transition: all var(--dur) var(--ease-out);
}

.mode-pill:hover {
  border-color: var(--brand-400);
  color: var(--text-primary);
}

.mode-pill[data-mode='ai'] {
  background: var(--brand-50);
  border-color: color-mix(in srgb, var(--brand-500) 42%, transparent);
  color: var(--brand-700);
}

:root[data-theme='dark'] .mode-pill[data-mode='ai'] {
  color: var(--brand-300);
}

.pill-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
}

.mode-pill[data-mode='ai'] .pill-dot {
  background: var(--ok-500);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok-500) 22%, transparent);
}

.hs {
  display: flex;
  flex-direction: column;
  min-width: 76px;
}

.hs b {
  font-size: 18px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.hs span {
  font-size: 11.5px;
  color: var(--text-muted);
}

.workbench {
  display: grid;
  grid-template-columns: minmax(0, 1.62fr) minmax(280px, 1fr);
  gap: var(--space-5);
  align-items: start;
}

.wb-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  position: sticky;
  top: calc(var(--header-h) + 16px);
}

.feat-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.feat-item {
  display: flex;
  gap: 9px;
  padding: 9px 11px;
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  animation: ya-fade-up 280ms var(--ease-out) both;
}

.feat-icon {
  font-size: 15px;
}

.feat-title {
  font-size: 12.8px;
  font-weight: 650;
}

.feat-desc {
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.5;
  margin-top: 1px;
}

.spec-mini {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.spec-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12.5px;
}

.field-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.field-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  padding: 3px 9px;
  border-radius: var(--radius-full);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
}

.field-pill i {
  font-style: normal;
  font-size: 9.5px;
  color: var(--text-muted);
}

.page-pill {
  font-size: 11.5px;
  padding: 3px 9px;
  border-radius: var(--radius-full);
  background: var(--brand-50);
  color: var(--brand-700);
}
:root[data-theme='dark'] .page-pill {
  color: var(--brand-300);
}

.idea-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}

.idea {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-subtle);
  font-size: 12px;
  color: var(--text-secondary);
  text-align: left;
  transition: all var(--dur) var(--ease-out);
}

.idea:hover {
  border-color: var(--brand-400);
  color: var(--brand-600);
  background: var(--brand-50);
  transform: translateY(-1px);
}

.idea-icon {
  font-size: 14px;
}

.hub {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.hub-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-4);
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding-top: var(--space-5);
  margin-top: var(--space-4);
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
  flex-wrap: wrap;
}

.remove-body p {
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.help {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.help-step {
  display: flex;
  gap: 12px;
}

.help-num {
  width: 24px;
  height: 24px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--brand-50);
  color: var(--brand-600);
  font-size: 12px;
  font-weight: 700;
}

.help-step b {
  font-size: 13.5px;
}

.help-step p {
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.65;
  margin-top: 2px;
}

@media (max-width: 1020px) {
  .workbench {
    grid-template-columns: 1fr;
  }
  .wb-side {
    position: static;
  }
}

@media (max-width: 720px) {
  .hero-title {
    font-size: 21px;
  }
  .hero-stats {
    width: 100%;
    justify-content: space-between;
  }
  .app-grid {
    grid-template-columns: 1fr;
  }
}
</style>
