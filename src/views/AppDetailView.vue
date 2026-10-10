<template>
  <div class="page">
    <template v-if="app">
      <AppNavbar
        :app="displaySpec"
        :record-count="records.length"
        @back="goHome"
        @export="exportConfig"
        @remove="showRemove = true"
        @history="openHistory"
      />

      <main class="ya-shell body">
        <!-- 模式切换 -->
        <div class="mode-row">
          <div class="ya-tabs">
            <button class="ya-tab" :data-active="mode === 'live'" @click="mode = 'live'">🚀 实际使用应用</button>
            <button class="ya-tab" :data-active="mode === 'studio'" @click="mode = 'studio'">
              🛠️ 功能清单与 Spec 配置编辑
            </button>
          </div>

          <div class="ya-row" style="gap: 8px">
            <span class="ya-badge ya-badge-mono">v{{ displaySpec.version }}</span>
            <span class="ya-badge" :class="dirty ? 'ya-badge-warn' : 'ya-badge-ok'">
              {{ dirty ? '有未应用的改动' : '已同步' }}
            </span>
          </div>
        </div>

        <!-- ===================== 实际使用 ===================== -->
        <template v-if="mode === 'live'">
          <div class="live-head">
            <div class="ya-tabs">
              <button
                v-for="page in displaySpec.pages"
                :key="page.pageId"
                class="ya-tab"
                :data-active="activePageId === page.pageId"
                @click="activePageId = page.pageId"
              >
                {{ page.pageType === 'form' ? '📝' : '📊' }} {{ page.pageTitle }}
              </button>
            </div>
            <button class="ya-btn ya-btn-primary" @click="openIterate">
              🤖 用 AI 迭代此 App
            </button>
          </div>

          <div v-if="dirty" class="ya-note ya-note-warn">
            <span>⚠️</span>
            <span>
              配置编辑区有未应用的改动。切到「功能清单与 Spec 配置编辑」点击
              <b>重新构建并运行应用</b> 后，新字段与新功能才会在这里生效。
            </span>
          </div>

          <section v-if="activePage" class="live-body">
            <!-- 表单页 -->
            <template v-if="activePage.pageType === 'form'">
              <div class="panel-card">
                <div class="panel-head">
                  <div>
                    <h2 class="ya-section-title">📝 {{ activePage.pageTitle }}</h2>
                    <p class="panel-sub">按字段规范录入一条{{ entity.entityName }}，带 <span class="req">*</span> 的为必填项</p>
                  </div>
                  <span class="ya-badge">{{ entity.fields.length }} 个字段</span>
                </div>
                <div class="panel-body">
                  <DynamicForm :entity="entity" @submit="onSubmitRecord" />
                </div>
              </div>

              <div class="recent">
                <div class="panel-head" style="border: none; padding: 0 0 10px">
                  <h3 class="ya-section-title" style="font-size: 13.5px">🕒 最近提交（{{ records.length }} 条）</h3>
                  <button class="ya-btn ya-btn-ghost ya-btn-sm" @click="switchToTable">查看全部 →</button>
                </div>
                <div v-if="recentRecords.length" class="recent-list">
                  <div v-for="r in recentRecords" :key="r.id" class="recent-item">
                    <span class="recent-icon">📄</span>
                    <div class="ya-grow">
                      <div class="recent-title">{{ summarizeRecord(r) }}</div>
                      <div class="recent-sub">{{ timeAgo(r.createdAt) }}</div>
                    </div>
                  </div>
                </div>
                <div v-else class="ya-empty" style="padding: 20px">还没有数据，提交第一条吧</div>
              </div>
            </template>

            <!-- 表格页 -->
            <template v-else>
              <StatSummary v-if="activePage.features?.includes('chart') || true" :entity="entity" :records="records" />
              <div class="panel-card">
                <div class="panel-head">
                  <div>
                    <h2 class="ya-section-title">📊 {{ activePage.pageTitle }}</h2>
                    <p class="panel-sub">数据保存在本机浏览器 · 支持检索、排序与导出</p>
                  </div>
                  <span class="ya-badge">{{ records.length }} 条</span>
                </div>
                <div class="panel-body">
                  <DynamicTable
                    :entity="entity"
                    :records="records"
                    :features="activePage.features || []"
                    @export="exportCsv"
                    @edit="startEdit"
                    @delete="askDelete"
                  />
                </div>
              </div>
            </template>
          </section>
        </template>

        <!-- ===================== 工作室 ===================== -->
        <template v-else>
          <div class="studio-grid">
            <section class="studio-col">
              <div class="col-head">
                <div>
                  <h2 class="ya-section-title">🧩 功能清单（可编辑）</h2>
                  <p class="panel-sub">用中文增删改功能，右侧详细 Spec 会同步推导</p>
                </div>
                <span class="ya-badge ya-badge-brand">{{ featureList.length }} 项</span>
              </div>
              <FeatureEditor
                :feature-list="featureList"
                :entity="entity"
                :added-ids="addedFeatureIds"
                :removed-ids="removedFeatureIds"
                :context="`${app.appName} ${app.description || ''}`"
                @update="onFeatureUpdate"
                @instruction="onFeatureInstruction"
                @rebuild-diff="openRebuild"
              />
            </section>

            <section class="studio-col">
              <div class="col-head">
                <div>
                  <h2 class="ya-section-title">🧬 详细 Spec（实时联动）</h2>
                  <p class="panel-sub">字段名称、类型、选项都可以直接改</p>
                </div>
                <span class="ya-badge" :class="dirty ? 'ya-badge-warn' : 'ya-badge-ok'">
                  {{ dirty ? '待同步' : '与功能清单一致' }}
                </span>
              </div>

              <SpecPreview
                :spec="previewSpec"
                :entity="entity"
                :changed-keys="changedKeys"
                :removed-fields="removedFields"
                :added-pages="addedPages"
                :record-count="records.length"
                @patch-field="patchField"
                @add-field="addField"
                @remove-field="removeField"
              />
            </section>
          </div>
        </template>

        <SyncBar
          :dirty="dirty"
          :busy="rebuilding"
          :current-version="displaySpec.version"
          :summary="diffSummary"
          :change-chips="changeChips"
          @sync="syncSpec"
          @rebuild="openRebuild"
        />
      </main>

      <!-- 用 AI 迭代 -->
      <BaseModal v-model="showIterate" icon="🤖" title="用 AI 迭代此 App" width="640px">
        <div class="ya-stack">
          <div class="ya-note ya-note-info">
            <span>💡</span>
            <span>直接说你想加什么、改什么，例如「在工时表单增加加班类型字段」「去掉审核步骤」。</span>
          </div>

          <div class="iter-log">
            <div v-for="m in chat.messages" :key="m.id" class="iter-msg" :data-role="m.role">
              <MarkdownText :text="m.content" />
            </div>
          </div>

          <div v-if="pendingIteration" class="iter-preview">
            <div class="ya-label">📋 方案预览（尚未应用）</div>
            <ul class="iter-list">
              <li v-for="f in chat.featureList" :key="f.id">{{ f.icon }} {{ f.title }} — {{ f.description }}</li>
            </ul>
            <div v-if="iterDiff.length" class="iter-diff">
              <div v-for="(d, i) in iterDiff" :key="i" class="ya-note" :class="d.tone === 'warn' ? 'ya-note-warn' : 'ya-note-ok'">
                {{ d.text }}
              </div>
            </div>
          </div>

          <div class="ya-row" style="gap: 8px; align-items: flex-start">
            <textarea
              v-model="iterInput"
              class="ya-textarea"
              rows="2"
              placeholder="描述你的迭代需求…"
              :disabled="chat.thinking"
              @keydown.enter.exact.prevent="runIterate"
            />
            <button class="ya-btn ya-btn-primary" :disabled="!iterInput.trim() || chat.thinking" @click="runIterate">
              {{ chat.thinking ? '思考中…' : '提交' }}
            </button>
          </div>

          <div class="ya-row" style="justify-content: flex-end">
            <button class="ya-btn ya-btn-ghost" :disabled="!pendingIteration" @click="applyIteration">
              ✅ 应用到功能清单
            </button>
          </div>
        </div>
      </BaseModal>

      <!-- 编辑记录 -->
      <BaseModal v-model="showEdit" icon="✏️" :title="`编辑${entity.entityName}`" width="720px">
        <DynamicForm :entity="entity" :initial="editingRecord" editing @submit="saveEdit" />
      </BaseModal>

      <!-- 删除记录 -->
      <BaseModal v-model="showDelete" icon="🗑️" title="删除这条记录？" width="480px">
        <p style="font-size: 13.5px; color: var(--text-secondary); line-height: 1.7">
          即将删除：<b>{{ deletingRecord ? summarizeRecord(deletingRecord) : '' }}</b><br />
          删除后无法恢复（本地数据）。
        </p>
        <template #footer>
          <button class="ya-btn ya-btn-ghost" @click="showDelete = false">取消</button>
          <button class="ya-btn ya-btn-danger" @click="confirmDelete">确认删除</button>
        </template>
      </BaseModal>

      <!-- 重新构建确认 -->
      <BaseModal
        v-model="showRebuild"
        icon="🚀"
        :title="`重新构建并升级到 v${nextVersion}`"
        subtitle="将执行数据无损迁移检查，原有数据不会丢失"
        width="680px"
      >
        <div class="ya-stack">
          <div v-if="rebuildDiff?.changes?.length" class="diff-list">
            <div
              v-for="(c, i) in rebuildDiff.changes"
              :key="i"
              class="ya-note"
              :class="c.kind.includes('remove') ? 'ya-note-warn' : c.kind.includes('add') ? 'ya-note-ok' : 'ya-note-info'"
            >
              <span>{{ c.kind.includes('remove') ? '⚠️' : c.kind.includes('add') ? '✨' : '🔧' }}</span>
              <span>{{ c.detail }}</span>
            </div>
          </div>
          <div v-else class="ya-note ya-note-info">
            <span>ℹ️</span>
            <span>未检测到结构变化，将仅刷新版本与配置。</span>
          </div>

          <div v-if="rebuildDiff?.metaChanges?.length" class="ya-note ya-note-info">
            <span>🏷️</span>
            <span>{{ rebuildDiff.metaChanges.join('；') }}</span>
          </div>

          <div v-if="rebuildStats" class="impact">
            <div class="impact-row">
              <span>受影响的现有数据</span>
              <b>{{ records.length }} 条</b>
            </div>
            <div v-if="rebuildStats.patchedRecords" class="impact-row">
              <span>需补齐新字段的记录</span>
              <b>{{ rebuildStats.patchedRecords }} 条（标记为「待补充」）</b>
            </div>
            <div v-if="rebuildStats.archivedValues" class="impact-row warn">
              <span>进入归档区的历史值</span>
              <b>{{ rebuildStats.archivedValues }} 处（保存在 _archived 中，不会丢失）</b>
            </div>
          </div>

          <label v-if="rebuildStats?.archivedValues" class="ya-check">
            <input v-model="confirmedArchive" type="checkbox" />
            我明白删除字段会使「{{ rebuildStats.removedFields.join('、') }}」不再展示，历史数据转入归档
          </label>
        </div>

        <template #footer>
          <button class="ya-btn ya-btn-ghost" @click="showRebuild = false">取消</button>
          <button
            class="ya-btn ya-btn-success"
            :disabled="rebuilding || (Boolean(rebuildStats?.archivedValues) && !confirmedArchive)"
            @click="doRebuild"
          >
            {{ rebuilding ? '迁移中…' : '确认并重新构建' }}
          </button>
        </template>
      </BaseModal>

      <!-- 版本历史 -->
      <BaseModal v-model="showHistory" icon="🕘" title="版本历史" subtitle="每次构建/重建都会生成快照，可回滚" width="660px">
        <div v-if="snapshots.length" class="history">
          <div v-for="s in snapshots" :key="s.id" class="ver">
            <div class="ya-grow">
              <div class="ver-title">
                <span class="ya-badge ya-badge-brand ya-badge-mono">v{{ s.version }}</span>
                {{ s.label }}
              </div>
              <div class="ver-sub">{{ new Date(s.createdAt).toLocaleString('zh-CN') }}</div>
            </div>
            <button
              class="ya-btn ya-btn-ghost ya-btn-sm"
              :disabled="s.version === displaySpec.version"
              @click="rollback(s)"
            >
              {{ s.version === displaySpec.version ? '当前版本' : '回滚到此版本' }}
            </button>
          </div>
        </div>
        <div v-else class="ya-empty">
          <div class="ya-empty-icon">🕘</div>
          <div>暂无版本快照</div>
        </div>
      </BaseModal>

      <!-- 删除应用 -->
      <BaseModal v-model="showRemove" icon="⚠️" title="删除应用" subtitle="该操作不可撤销" width="520px">
        <p style="font-size: 13.5px; line-height: 1.7; color: var(--text-secondary)">
          即将删除「<b>{{ app.appName }}</b>」及其 <b>{{ records.length }}</b> 条本地数据与全部版本快照。
        </p>
        <label class="ya-check" style="margin-top: 12px">
          <input v-model="exportBeforeDelete" type="checkbox" />
          删除前先导出备份
        </label>
        <template #footer>
          <button class="ya-btn ya-btn-ghost" @click="showRemove = false">取消</button>
          <button class="ya-btn ya-btn-danger" @click="confirmRemoveApp">确认删除</button>
        </template>
      </BaseModal>
    </template>

    <div v-else class="ya-shell loading">
      <div class="ya-empty">
        <div class="ya-empty-icon">⏳</div>
        <div>{{ loadError || '正在读取应用配置…' }}</div>
        <button v-if="loadError" class="ya-btn ya-btn-ghost" style="margin-top: 14px" @click="goHome">返回首页</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppNavbar from '@/components/app/AppNavbar.vue'
import DynamicForm from '@/components/engine/DynamicForm.vue'
import DynamicTable from '@/components/engine/DynamicTable.vue'
import StatSummary from '@/components/engine/StatSummary.vue'
import FeatureEditor from '@/components/studio/FeatureEditor.vue'
import SpecPreview from '@/components/studio/SpecPreview.vue'
import SyncBar from '@/components/studio/SyncBar.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import MarkdownText from '@/components/ui/MarkdownText.vue'
import { useAppsStore } from '@/stores/apps.js'
import { useChatStore } from '@/stores/chat.js'
import { buildIteratedSpec } from '@/engine/agent.js'
import { diffSpec, migrateRecords } from '@/engine/diff.js'
import { bumpMinorVersion, cloneSpec, normalizeSpec } from '@/engine/spec.js'
import {
  createRecord,
  exportApp as exportAppPayload,
  listRecords,
  listSnapshots,
  removeRecord,
  saveApp,
  updateRecord,
} from '@/services/storageService.js'
import { buildCsvFilename, downloadFile, displayValue, recordsToCsv, timeAgo } from '@/utils/format.js'
import { toast } from '@/composables/useToast.js'

const route = useRoute()
const router = useRouter()
const apps = useAppsStore()
const chat = useChatStore()

const app = ref(null)
const loadError = ref('')
const records = ref([])
const mode = ref('live')
const activePageId = ref('')

/* 工作室状态 */
const featureList = ref([])
const previewSpec = ref(null)
const baselineSpec = ref(null) // 最近一次已构建的 Spec
const featuresDirty = ref(false)
const specDirty = ref(false)
/** 用户在 Spec 编辑器里的显式编辑意图（重编译时必须尊重） */
const userAddedFieldLabels = ref([])
const userRemovedFieldLabels = ref([])

const rebuilding = ref(false)
const snapshots = ref([])

/* 弹窗 */
const showIterate = ref(false)
const iterInput = ref('')
const pendingIteration = ref(null)
const showEdit = ref(false)
const editingRecord = ref(null)
const showDelete = ref(false)
const deletingRecord = ref(null)
const showRebuild = ref(false)
const showHistory = ref(false)
const showRemove = ref(false)
const exportBeforeDelete = ref(true)
const confirmedArchive = ref(false)
const rebuildStats = ref(null)

const entity = computed(() => {
  const spec = previewSpec.value || app.value
  if (!spec) return { entityId: '', entityName: '', fields: [] }
  const target = activePage.value?.targetEntity
  return spec.entities.find((e) => e.entityId === target) || spec.entities[0]
})

const activePage = computed(() => displaySpec.value?.pages.find((p) => p.pageId === activePageId.value) || displaySpec.value?.pages[0])

const displaySpec = computed(() => previewSpec.value || app.value || { pages: [], entities: [{ fields: [] }], version: '-' })

const dirty = computed(() => featuresDirty.value || specDirty.value)

const recentRecords = computed(() => records.value.slice(0, 4))

const nextVersion = computed(() => bumpMinorVersion(displaySpec.value.version))

/** 重新构建的实际差异快照（在点击「重新构建」时计算并冻结，避免弹窗读到过期数据） */
const frozenDiff = ref(null)

/** 编辑过程中的实时差异（仅用于底部同步栏提示，不参与重建逻辑） */
const liveDiff = computed(() =>
  baselineSpec.value && previewSpec.value ? diffSpec(baselineSpec.value, previewSpec.value) : null,
)

const rebuildDiff = computed(() => frozenDiff.value)

const diffSummary = computed(() => liveDiff.value?.summary || '')

const changeChips = computed(() => {
  const d = liveDiff.value
  if (!d) return []
  const chips = []
  if (d.addedFields.length) chips.push({ tone: 'ok', text: `＋${d.addedFields.length} 字段` })
  if (d.removedFields.length) chips.push({ tone: 'warn', text: `－${d.removedFields.length} 字段` })
  if (d.updatedFields.length) chips.push({ tone: 'info', text: `~${d.updatedFields.length} 字段` })
  if (d.addedFeatures.length) chips.push({ tone: 'ok', text: `＋${d.addedFeatures.length} 功能` })
  if (d.removedFeatures.length) chips.push({ tone: 'warn', text: `－${d.removedFeatures.length} 功能` })
  if (d.addedPages.length || d.removedPages.length) {
    chips.push({ tone: 'info', text: `页面 ${d.addedPages.length ? `＋${d.addedPages.length}` : ''}${d.removedPages.length ? ` －${d.removedPages.length}` : ''}` })
  }
  return chips
})

// 编辑过程中的高亮 / 待移除提示使用实时差异；重建弹窗使用冻结快照
const changedKeys = computed(() => (liveDiff.value?.updatedFields || []).map((u) => u.field.key))
const removedFields = computed(() => liveDiff.value?.removedFields || [])
const addedPages = computed(() => (liveDiff.value?.addedPages || []).map((p) => p.pageId))
const addedFeatureIds = computed(() =>
  (liveDiff.value?.addedFeatures || []).map((f) => featureList.value.find((x) => x.title === f.title)?.id).filter(Boolean),
)
const removedFeatureIds = computed(() =>
  (liveDiff.value?.removedFeatures || []).map((f) => featureList.value.find((x) => x.title === f.title)?.id).filter(Boolean),
)

const iterDiff = computed(() => {
  if (!pendingIteration.value || !baselineSpec.value) return []
  const d = diffSpec(baselineSpec.value, pendingIteration.value)
  return d.changes.slice(0, 6).map((c) => ({
    tone: c.kind.includes('remove') ? 'warn' : 'ok',
    text: c.detail,
  }))
})

/* ------------------------------- 数据加载 ------------------------------- */

onMounted(load)
watch(() => route.params.appId, load)

async function load() {
  loadError.value = ''
  const appId = String(route.params.appId || '')
  try {
    const spec = await apps.fetchOne(appId)
    if (!spec) {
      loadError.value = '应用不存在或已被删除'
      app.value = null
      return
    }
    const normalized = normalizeSpec(spec, {})
    app.value = normalized
    baselineSpec.value = cloneSpec(normalized)
    previewSpec.value = cloneSpec(normalized)
    featureList.value = normalized.featureList?.length
      ? normalized.featureList
      : [
          { id: 'feat_1', icon: '📝', title: `${normalized.entities[0].entityName}填报`, description: '录入数据' },
          { id: 'feat_2', icon: '📋', title: `${normalized.entities[0].entityName}查询`, description: '查看与导出数据' },
        ]
    activePageId.value = normalized.pages[0]?.pageId || ''
    featuresDirty.value = false
    specDirty.value = false
    userAddedFieldLabels.value = []
    userRemovedFieldLabels.value = []
    await reloadRecords()
    snapshots.value = await listSnapshots(appId)
    mode.value = 'live'
  } catch (e) {
    loadError.value = e?.message || '读取失败'
  }
}

async function reloadRecords() {
  if (!app.value) return
  const entityId = baselineSpec.value.entities[0].entityId
  records.value = await listRecords(app.value.appId, entityId)
}

/* ------------------------------- 实际使用 ------------------------------- */

async function onSubmitRecord(values) {
  try {
    await createRecord(app.value.appId, entity.value.entityId, values)
    await reloadRecords()
    apps.bumpCount(app.value.appId, 1)
    toast.ok(`已提交，${entity.value.entityName}共 ${records.value.length} 条`)
  } catch (e) {
    toast.error(e?.message || '提交失败')
  }
}

function startEdit(record) {
  editingRecord.value = record
  showEdit.value = true
}

async function saveEdit(values) {
  try {
    await updateRecord(editingRecord.value.id, values)
    showEdit.value = false
    editingRecord.value = null
    await reloadRecords()
    toast.ok('记录已更新')
  } catch (e) {
    toast.error(e?.message || '保存失败')
  }
}

function askDelete(record) {
  deletingRecord.value = record
  showDelete.value = true
}

async function confirmDelete() {
  try {
    await removeRecord(deletingRecord.value.id)
    await reloadRecords()
    apps.bumpCount(app.value.appId, -1)
    toast.ok('记录已删除')
  } catch (e) {
    toast.error(e?.message || '删除失败')
  } finally {
    showDelete.value = false
    deletingRecord.value = null
  }
}

function switchToTable() {
  const table = displaySpec.value.pages.find((p) => p.pageType === 'table')
  if (table) activePageId.value = table.pageId
}

function summarizeRecord(record) {
  const fields = entity.value.fields.slice(0, 3)
  const parts = fields
    .map((f) => displayValue(f, record.values?.[f.key]))
    .filter(Boolean)
    .slice(0, 3)
  return parts.join(' · ') || record.id
}

/* --------------------------------- 导出 --------------------------------- */

async function exportCsv() {
  const table = activePage.value
  const rows = records.value
  if (!rows.length) return
  const csv = recordsToCsv(entity.value, rows)
  downloadFile(buildCsvFilename(app.value.appName, entity.value.entityName), csv, 'text/csv;charset=utf-8')
  toast.ok(`已导出 ${rows.length} 条记录为 CSV`)
  void table
}

async function exportConfig() {
  try {
    const payload = await exportAppPayload(app.value.appId, { includeRecords: true })
    downloadFile(`yours-app_${app.value.appName}.json`, JSON.stringify(payload, null, 2), 'application/json')
    toast.ok('已导出应用配置与数据')
  } catch (e) {
    toast.error(e?.message || '导出失败')
  }
}

/* ------------------------------- 工作室联动 ------------------------------ */

function applyPreview(nextSpec, { featuresChanged = false, keepNewFields = false } = {}) {
  previewSpec.value = mergeRecompiledIntoPreview(nextSpec, previewSpec.value, { keepNewFields })
  if (featuresChanged) featuresDirty.value = true
}

function onFeatureUpdate(next) {
  featureList.value = next
  const nextSpec = chat.setFeatureList(next, app.value.description)
  applyPreview(nextSpec, { featuresChanged: true })
}

/** 功能清单区的自然语言增改：子组件已执行变更，这里只负责重算预览与差异 */
function onFeatureInstruction(text, result) {
  void text
  featureList.value = (result?.featureList || chat.featureList).map((f) => ({ ...f }))
  applyPreview(result?.spec || chat.spec, { featuresChanged: Boolean(result?.changed) })
}

function syncSpec() {
  const next = chat.recompile({
    baseText: app.value.description,
    intentTexts: chat.instructionLog,
    previousSpec: baselineSpec.value,
  })
  applyPreview(next, { featuresChanged: true })
  toast.info('详细 Spec 已按最新功能清单同步')
}

function patchField(key, patch) {
  const spec = cloneSpec(previewSpec.value)
  const target = spec.entities.find((e) => e.entityId === entity.value.entityId) || spec.entities[0]
  const field = target.fields.find((f) => f.key === key)
  if (!field) return
  Object.assign(field, patch)
  previewSpec.value = spec
  specDirty.value = true
}

function addField() {
  const spec = cloneSpec(previewSpec.value)
  const target = spec.entities.find((e) => e.entityId === entity.value.entityId) || spec.entities[0]
  const index = target.fields.length + 1
  const key = `newField${index}`
  target.fields.push({
    key,
    label: '新字段',
    type: 'text',
    required: false,
    placeholder: '',
    help: '',
  })
  previewSpec.value = spec
  specDirty.value = true
  toast.info('已添加字段，请修改名称与类型后点击「重新构建」')
}

function removeField(key) {
  const spec = cloneSpec(previewSpec.value)
  const target = spec.entities.find((e) => e.entityId === entity.value.entityId) || spec.entities[0]
  const doomed = target.fields.find((f) => f.key === key)
  target.fields = target.fields.filter((f) => f.key !== key)
  previewSpec.value = spec
  specDirty.value = true
  // 记住用户删掉了什么（只记这一次点名的字段），重编译后不能再让它长回来
  if (doomed) {
    userRemovedFieldLabels.value = Array.from(new Set([...userRemovedFieldLabels.value, doomed.label]))
  }
}

/**
 * 把「重编译结果」合并进用户当前编辑中的 Spec：
 * - 以编辑器里的字段为准（保留用户改过的名称、类型、选项，以及手工删除的字段）
 * - 只把重编译真正新增的字段补进来（如新功能带来的数据项）
 * @param {object} recompiled chat.recompile 的结果
 * @param {object} current 当前编辑中的 Spec（previewSpec）
 */
function mergeRecompiledIntoPreview(recompiled, current, { keepNewFields = false } = {}) {
  const merged = normalizeSpec(recompiled, baselineSpec.value)
  const target = merged.entities[0]
  const currentFields = current?.entities?.[0]?.fields || []

  // 用户改过的字段优先：按 key 对齐覆盖标签、类型、选项等
  const currentByKey = new Map(currentFields.map((f) => [f.key, f]))
  target.fields = target.fields.map((f) => (currentByKey.has(f.key) ? { ...f, ...currentByKey.get(f.key) } : f))

  // 用户手工新增的字段（重编译推导不出来的）需要保留
  const keepLabels = keepNewFields ? currentFields.map((f) => f.label) : userAddedFieldLabels.value
  for (const f of currentFields) {
    const exists = target.fields.some((t) => t.key === f.key || t.label === f.label)
    if (!exists && keepLabels.includes(f.label)) target.fields.push(f)
  }

  // 用户在编辑器里删掉的字段，重编译后再次剔除
  const removed = new Set(userRemovedFieldLabels.value)
  target.fields = target.fields.filter((f) => !removed.has(f.label))
  return merged
}

/* -------------------------------- 重新构建 ------------------------------- */

function openRebuild() {
  // 以「本页加载的那一版 Spec」为基线重编译，再把结果合并进用户正在编辑的 Spec
  const nextSpec = chat.recompile({
    baseText: app.value.description,
    intentTexts: chat.instructionLog,
    previousSpec: baselineSpec.value,
  })
  previewSpec.value = mergeRecompiledIntoPreview(nextSpec, previewSpec.value)
  // 冻结本次重建的差异（弹窗、按钮禁用与迁移统计都基于同一份快照）
  const diff = diffSpec(baselineSpec.value, previewSpec.value)
  frozenDiff.value = diff
  if (!diff.hasChanges) {
    frozenDiff.value = null
    toast.info('当前配置与已构建版本一致，无需重新构建')
    return
  }
  const { stats } = migrateRecords(records.value, baselineSpec.value, previewSpec.value)
  rebuildStats.value = { ...stats, removedFields: diff.removedFields.map((f) => f.label) }
  confirmedArchive.value = false
  showRebuild.value = true
}

async function doRebuild() {
  rebuilding.value = true
  try {
    const diff = rebuildDiff.value
    const notes = diff.changes.map((c) => c.detail)
    const result = await apps.rebuild({
      currentSpec: baselineSpec.value,
      nextSpec: previewSpec.value,
      changeNotes: notes,
    })
    await load()
    mode.value = 'live'
    showRebuild.value = false
    frozenDiff.value = null
    const stats = result.stats
    const extra = stats.archivedValues ? `，${stats.archivedValues} 处历史值已归档保留` : ''
    toast.ok(`已升级到 v${result.version}，${result.migratedCount} 条数据完成无损迁移${extra}`, '重新构建完成')
    apps.lastBuiltId = app.value.appId
  } catch (e) {
    toast.error(e?.message || '重新构建失败')
  } finally {
    rebuilding.value = false
  }
}

/* --------------------------------- 迭代 --------------------------------- */

function openIterate() {
  chat.loadApp(baselineSpec.value)
  chat.featureList = featureList.value.map((f) => ({ ...f }))
  pendingIteration.value = null
  iterInput.value = ''
  showIterate.value = true
}

async function runIterate() {
  const text = iterInput.value.trim()
  if (!text) return
  iterInput.value = ''
  await chat.iterateWithText(text)
  const next = buildIteratedSpec({
    currentSpec: baselineSpec.value,
    featureList: chat.featureList,
    draft: chat.draft,
  })
  pendingIteration.value = next
}

function applyIteration() {
  if (!pendingIteration.value) return
  featureList.value = chat.featureList.map((f) => ({ ...f }))
  previewSpec.value = normalizeSpec(pendingIteration.value, baselineSpec.value)
  featuresDirty.value = true
  specDirty.value = false
  showIterate.value = false
  mode.value = 'studio'
  toast.ok('方案已应用到编辑区，确认无误后点击「重新构建并运行应用」')
}

/* --------------------------------- 版本 --------------------------------- */

async function openHistory() {
  snapshots.value = await listSnapshots(app.value.appId)
  showHistory.value = true
}

async function rollback(snapshot) {
  try {
    const restored = { ...cloneSpec(snapshot.spec), appId: app.value.appId, version: snapshot.version }
    await saveApp(restored, { snapshotLabel: `回滚到 v${snapshot.version}` })
    showHistory.value = false
    await load()
    await apps.refresh()
    toast.ok(`已回滚到 v${snapshot.version}（数据记录保持不变）`)
  } catch (e) {
    toast.error(e?.message || '回滚失败')
  }
}

/* --------------------------------- 其他 --------------------------------- */

async function confirmRemoveApp() {
  try {
    if (exportBeforeDelete.value) await exportConfig()
    await apps.remove(app.value.appId)
    toast.ok(`已删除「${app.value.appName}」`)
    goHome()
  } catch (e) {
    toast.error(e?.message || '删除失败')
  }
}

function goHome() {
  router.push({ name: 'home' })
}
</script>

<style scoped>
.page {
  min-height: 100%;
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-top: var(--space-5);
  padding-bottom: var(--space-8);
}

.mode-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.live-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.live-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.panel-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 15px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}

.panel-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 3px;
}

.panel-body {
  padding: 18px;
}

.req {
  color: var(--danger-500);
}

.recent {
  display: flex;
  flex-direction: column;
}

.recent-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-3);
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 13px;
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  animation: ya-fade-up 260ms var(--ease-out) both;
}

.recent-icon {
  font-size: 15px;
}

.recent-title {
  font-size: 12.8px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-sub {
  font-size: 11.5px;
  color: var(--text-muted);
}

.studio-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}

.studio-col {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  box-shadow: var(--shadow-xs);
}

.col-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.iter-log {
  max-height: 190px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
}

.iter-msg {
  font-size: 12.8px;
}

.iter-msg[data-role='user'] {
  color: var(--brand-600);
  font-weight: 600;
}

.iter-preview {
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--brand-400);
  background: color-mix(in srgb, var(--brand-50) 55%, var(--bg-elevated));
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.iter-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
  color: var(--text-secondary);
}

.iter-diff {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.diff-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
}

.impact {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.impact-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 10px 14px;
  font-size: 12.8px;
  border-bottom: 1px solid var(--border);
}

.impact-row:last-child {
  border-bottom: none;
}

.impact-row b {
  font-weight: 650;
  color: var(--brand-600);
}

.impact-row.warn b {
  color: var(--warn-600);
}

.history {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 380px;
  overflow-y: auto;
}

.ver {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.ver-title {
  font-size: 13px;
  font-weight: 620;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ver-sub {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 2px;
}

.loading {
  padding-top: 80px;
}

@media (max-width: 980px) {
  .studio-grid {
    grid-template-columns: 1fr;
  }
}
</style>
