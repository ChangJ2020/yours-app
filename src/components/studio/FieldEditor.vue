<template>
  <div class="field-editor" :data-changed="changed">
    <div class="head">
      <input v-model="draft.label" class="ya-input label-input" placeholder="字段名称" @input="flush" />
      <span class="ya-badge ya-badge-mono">{{ typeLabel }}</span>
      <button
        class="ya-btn ya-btn-quiet ya-btn-icon"
        :title="field.required ? '必填（点击取消）' : '非必填（点击设为必填）'"
        @click="toggleRequired"
      >
        {{ field.required ? '❗' : '○' }}
      </button>
      <button class="ya-btn ya-btn-quiet ya-btn-icon" title="删除字段" @click="emit('remove')">🗑️</button>
    </div>

    <div v-if="expanded" class="body">
      <div class="ya-row" style="gap: 8px; flex-wrap: wrap">
        <select class="ya-select" style="width: auto; min-width: 118px" :value="field.type" @change="changeType($event.target.value)">
          <option v-for="t in FIELD_TYPES" :key="t.type" :value="t.type">{{ t.label }}</option>
        </select>

        <template v-if="['number', 'currency'].includes(field.type)">
          <input
            class="ya-input"
            style="width: 88px"
            type="number"
            placeholder="最小值"
            :value="field.min ?? ''"
            @input="patch({ min: $event.target.value })"
          />
          <input
            class="ya-input"
            style="width: 88px"
            type="number"
            placeholder="最大值"
            :value="field.max ?? ''"
            @input="patch({ max: $event.target.value })"
          />
          <input
            class="ya-input"
            style="width: 78px"
            placeholder="单位"
            :value="field.unit ?? ''"
            @input="patch({ unit: $event.target.value })"
          />
        </template>
      </div>

      <div v-if="isOptionType" class="options">
        <div class="ya-label">候选项（点击可删除）</div>
        <div class="chips">
          <span v-for="(opt, i) in field.options || []" :key="opt + i" class="chip" @click="removeOption(i)">
            {{ opt }} <b>✕</b>
          </span>
        </div>
        <div class="ya-row" style="gap: 6px">
          <input
            v-model="newOption"
            class="ya-input"
            placeholder="输入新选项后回车"
            @keydown.enter.prevent="addOption"
          />
          <button class="ya-btn ya-btn-ghost ya-btn-sm" @click="addOption">添加</button>
        </div>
      </div>

      <p v-if="field.help" class="ya-help">{{ field.help }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { DEFAULT_OPTIONS, FIELD_TYPES, FIELD_TYPE_MAP, OPTION_TYPES } from '@/engine/spec.js'

const props = defineProps({
  field: { type: Object, required: true },
  changed: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
})

const emit = defineEmits(['patch', 'remove'])

const draft = reactive({ label: props.field.label })
const newOption = ref('')

watch(
  () => props.field.label,
  (v) => {
    draft.label = v
  },
)

const typeLabel = computed(() => FIELD_TYPE_MAP[props.field.type]?.label || props.field.type)
const isOptionType = computed(() => OPTION_TYPES.includes(props.field.type))

function flush() {
  emit('patch', { label: draft.label })
}

function patch(p) {
  emit('patch', p)
}

function toggleRequired() {
  patch({ required: !props.field.required })
}

function changeType(type) {
  const next = { type }
  if (OPTION_TYPES.includes(type) && !(props.field.options || []).length) next.options = [...DEFAULT_OPTIONS]
  if (['number', 'currency'].includes(type) && props.field.min === undefined) next.min = 0
  patch(next)
}

function addOption() {
  const v = newOption.value.trim()
  if (!v) return
  patch({ options: [...(props.field.options || []), v] })
  newOption.value = ''
}

function removeOption(index) {
  const options = [...(props.field.options || [])]
  options.splice(index, 1)
  patch({ options })
}
</script>

<style scoped>
.field-editor {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: var(--bg-elevated);
  transition: border-color var(--dur), background var(--dur);
}

.field-editor[data-changed='true'] {
  border-color: var(--brand-400);
  background: color-mix(in srgb, var(--brand-50) 60%, var(--bg-elevated));
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.label-input {
  flex: 1;
  min-width: 60px;
  border-color: transparent;
  background: transparent;
  font-weight: 600;
  padding: 4px 6px;
}

.label-input:hover,
.label-input:focus {
  background: var(--bg-elevated);
  border-color: var(--border);
}

.body {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  padding: 3px 9px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  color: var(--text-secondary);
  cursor: pointer;
  border: 1px solid transparent;
}

.chip:hover {
  border-color: var(--danger-500);
  color: var(--danger-600);
}

.chip b {
  font-size: 9px;
  opacity: 0.6;
}
</style>
