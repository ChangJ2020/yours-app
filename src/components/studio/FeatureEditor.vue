<template>
  <div class="feature-editor">
    <!-- 自然语言指令增改 -->
    <div class="nl-box">
      <div class="ya-row" style="gap: 8px; align-items: flex-start">
        <textarea
          v-model="instruction"
          class="ya-textarea"
          rows="2"
          placeholder="用一句话增改功能，例如：增加记录月度优秀员工的功能 / 去掉审核步骤"
          @keydown.enter.exact.prevent="applyInstruction"
        />
        <button class="ya-btn ya-btn-primary" :disabled="!instruction.trim() || busy" @click="applyInstruction">
          应用
        </button>
      </div>
      <div v-if="notes.length" class="notes">
        <div v-for="(n, i) in notes" :key="i" class="ya-note ya-note-ok">✨ {{ n }}</div>
      </div>
    </div>

    <!-- 功能卡片列表 -->
    <div class="list">
      <div
        v-for="(feature, index) in list"
        :key="feature.id"
        class="feat"
        :data-added="addedIds.includes(feature.id)"
        :data-removed="removedIds.includes(feature.id)"
      >
        <div class="feat-main">
          <button class="icon-btn" title="更换图标" @click="cycleIcon(index)">{{ feature.icon || '📌' }}</button>
          <div class="ya-grow">
            <template v-if="editingId === feature.id">
              <input
                v-model="editTitle"
                class="ya-input"
                style="font-weight: 600; margin-bottom: 6px"
                @keydown.enter.prevent="saveEdit(index)"
              />
              <input
                v-model="editDesc"
                class="ya-input"
                placeholder="一句话说明"
                @keydown.enter.prevent="saveEdit(index)"
              />
            </template>
            <template v-else>
              <div class="feat-title">
                {{ feature.title }}
                <span v-if="addedIds.includes(feature.id)" class="ya-badge ya-badge-ok">新增</span>
                <span v-if="removedIds.includes(feature.id)" class="ya-badge ya-badge-danger">待移除</span>
              </div>
              <div class="feat-desc">{{ feature.description }}</div>
            </template>
          </div>
          <div class="feat-actions">
            <template v-if="editingId === feature.id">
              <button class="ya-btn ya-btn-primary ya-btn-sm" @click="saveEdit(index)">保存</button>
              <button class="ya-btn ya-btn-quiet ya-btn-sm" @click="editingId = ''">取消</button>
            </template>
            <template v-else>
              <button class="ya-btn ya-btn-quiet ya-btn-sm" title="编辑" @click="startEdit(feature)">✏️</button>
              <button class="ya-btn ya-btn-quiet ya-btn-sm" title="上移" :disabled="index === 0" @click="move(index, -1)">↑</button>
              <button
                class="ya-btn ya-btn-quiet ya-btn-sm"
                title="下移"
                :disabled="index === list.length - 1"
                @click="move(index, 1)"
              >
                ↓
              </button>
              <button class="ya-btn ya-btn-quiet ya-btn-sm" title="删除" @click="remove(index)">🗑️</button>
            </template>
          </div>
        </div>

        <div v-if="relatedFields(feature).length" class="feat-fields">
          <span class="ya-muted" style="font-size: 11px">涉及字段：</span>
          <span v-for="f in relatedFields(feature)" :key="f.key" class="field-chip">
            {{ f.label }}<i>{{ FIELD_TYPE_MAP[f.type]?.label }}</i>
          </span>
        </div>
      </div>

      <div v-if="!list.length" class="ya-empty" style="padding: 24px">
        <div class="ya-empty-icon">🧩</div>
        <div>还没有功能项，先添加一个吧</div>
      </div>
    </div>

    <button class="add-btn" @click="addBlank">＋ 添加新功能项</button>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { FIELD_TYPE_MAP, normalizeFeature, uid } from '@/engine/spec.js'
import { applyFeatureText } from '@/services/featureService.js'
import { useChatStore } from '@/stores/chat.js'

const props = defineProps({
  featureList: { type: Array, default: () => [] },
  entity: { type: Object, default: null },
  addedIds: { type: Array, default: () => [] },
  removedIds: { type: Array, default: () => [] },
  context: { type: String, default: '' },
})

const emit = defineEmits(['update', 'instruction'])

const chat = useChatStore()

const instruction = ref('')
const notes = ref([])
const busy = ref(false)
const editingId = ref('')
const editTitle = ref('')
const editDesc = ref('')

const list = computed(() => props.featureList)

const ICONS = ['📌', '🕒', '📊', '📝', '📋', '🔍', '📤', '✅', '🔔', '🏅', '📦', '🤝', '💰', '⏰', '🧮', '📈', '🗂️', '🔒']

/** 首页/详情页共用的「字段归属」推断：按字段名是否出现在功能文案里 */
function relatedFields(feature) {
  const fields = props.entity?.fields || []
  const text = `${feature.title}${feature.description}`
  return fields.filter((f) => f.label && text.includes(f.label)).slice(0, 4)
}

function emitUpdate(next) {
  emit('update', next)
}

function startEdit(feature) {
  editingId.value = feature.id
  editTitle.value = feature.title
  editDesc.value = feature.description
}

function saveEdit(index) {
  const next = list.value.map((f, i) =>
    i === index ? { ...f, title: editTitle.value.trim() || f.title, description: editDesc.value.trim() } : f,
  )
  editingId.value = ''
  emitUpdate(next)
}

function remove(index) {
  const next = list.value.filter((_, i) => i !== index)
  emitUpdate(next)
}

function move(index, delta) {
  const next = [...list.value]
  const target = index + delta
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target], next[index]]
  emitUpdate(next)
}

function cycleIcon(index) {
  const next = list.value.map((f, i) => {
    if (i !== index) return f
    const cur = ICONS.indexOf(f.icon)
    return { ...f, icon: ICONS[(cur + 1) % ICONS.length] }
  })
  emitUpdate(next)
}

function addBlank() {
  const feature = normalizeFeature(
    { id: uid('feat'), icon: '🆕', title: '新功能', description: '请填写这个功能的用途说明' },
    list.value.length,
  )
  emitUpdate([...list.value, feature])
  startEdit(feature)
}

/**
 * 应用一句自然语言指令（父组件可通过 ref 调用，组件自身的「应用」按钮也会调用）。
 * 说明：Vue 的 emit 不返回值，所以这里直接调用服务层拿到真实执行结果，
 * 再 emit 一个信号让父级重算预览 —— 既不会父子互相等待死锁，提示文案也来自真实执行结果。
 * @param {string} text
 */
function applyFeatureInstruction(text) {
  const value = String(text ?? instruction.value).trim()
  if (!value || busy.value) return null
  busy.value = true
  notes.value = []
  try {
    const result = applyFeatureText({ chat, text: value, context: props.context })
    if (result.notes.length) {
      notes.value = result.notes
    } else if (!result.changed) {
      notes.value = ['未匹配到明确的功能改动，可换一种说法（例如「增加导出功能」）']
    }
    instruction.value = ''
    // 通知父级：功能清单已变更，请重算 Spec 预览与差异
    emit('instruction', value, result)
    return result
  } finally {
    busy.value = false
  }
}

function applyInstruction() {
  applyFeatureInstruction(instruction.value)
}

defineExpose({ applyFeatureInstruction })
</script>

<style scoped>
.feature-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.nl-box {
  padding: 10px;
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  border: 1px dashed var(--border-strong);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.notes {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.feat {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  background: var(--bg-elevated);
  transition: all var(--dur) var(--ease-out);
}

.feat:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-xs);
}

.feat[data-added='true'] {
  border-color: color-mix(in srgb, var(--ok-500) 45%, transparent);
  background: color-mix(in srgb, var(--ok-50) 55%, var(--bg-elevated));
  animation: ya-pop 320ms var(--ease-spring) both;
}

.feat[data-removed='true'] {
  opacity: 0.6;
  border-style: dashed;
  border-color: var(--danger-500);
}

.feat-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.icon-btn {
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 9px;
  background: var(--bg-subtle);
  font-size: 15px;
  display: grid;
  place-items: center;
}

.icon-btn:hover {
  background: var(--bg-sunken);
}

.feat-title {
  font-size: 13.5px;
  font-weight: 650;
  display: flex;
  align-items: center;
  gap: 7px;
}

.feat-desc {
  font-size: 12.5px;
  color: var(--text-muted);
  margin-top: 2px;
  line-height: 1.55;
}

.feat-actions {
  display: flex;
  gap: 2px;
  flex: none;
}

.feat-fields {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}

.field-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  color: var(--text-secondary);
}

.field-chip i {
  font-style: normal;
  font-size: 9.5px;
  color: var(--text-muted);
}

.add-btn {
  height: 38px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-strong);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  transition: all var(--dur) var(--ease-out);
}

.add-btn:hover {
  border-color: var(--brand-400);
  color: var(--brand-600);
  background: var(--brand-50);
}
</style>
