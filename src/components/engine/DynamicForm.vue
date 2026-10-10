<template>
  <form class="dyn-form" novalidate @submit.prevent="onSubmit">
    <div class="grid">
      <div
        v-for="field in entity.fields"
        :key="field.key"
        class="ya-field"
        :class="{ wide: field.type === 'textarea' }"
      >
        <label class="ya-label" :for="`f_${uid}_${field.key}`">
          {{ field.label }}
          <span v-if="field.required" class="req">*</span>
        </label>

        <!-- 单行文本 / 邮箱 / 手机号 -->
        <input
          v-if="['text', 'email', 'phone'].includes(field.type)"
          :id="`f_${uid}_${field.key}`"
          class="ya-input"
          :class="{ invalid: errors[field.key] }"
          :type="field.type === 'email' ? 'email' : 'text'"
          :inputmode="field.type === 'phone' ? 'numeric' : 'text'"
          :placeholder="placeholderOf(field)"
          :value="values[field.key] ?? ''"
          @input="set(field.key, $event.target.value)"
          @blur="touch(field.key)"
        />

        <!-- 多行文本 -->
        <textarea
          v-else-if="field.type === 'textarea'"
          :id="`f_${uid}_${field.key}`"
          class="ya-textarea"
          :class="{ invalid: errors[field.key] }"
          :placeholder="placeholderOf(field)"
          :value="values[field.key] ?? ''"
          @input="set(field.key, $event.target.value)"
          @blur="touch(field.key)"
        />

        <!-- 数字 / 金额 -->
        <div v-else-if="['number', 'currency'].includes(field.type)" class="num-wrap">
          <span v-if="field.type === 'currency'" class="prefix">¥</span>
          <input
            :id="`f_${uid}_${field.key}`"
            class="ya-input"
            :class="{ invalid: errors[field.key], 'has-prefix': field.type === 'currency' }"
            type="number"
            :step="field.step ?? (field.type === 'currency' ? 0.01 : 1)"
            :min="field.min"
            :max="field.max"
            :placeholder="placeholderOf(field)"
            :value="values[field.key] ?? ''"
            @input="set(field.key, $event.target.value)"
            @blur="touch(field.key)"
          />
          <span v-if="field.unit" class="suffix">{{ field.unit }}</span>
        </div>

        <!-- 日期 / 日期时间 -->
        <input
          v-else-if="['date', 'datetime'].includes(field.type)"
          :id="`f_${uid}_${field.key}`"
          class="ya-input"
          :class="{ invalid: errors[field.key] }"
          :type="field.type === 'date' ? 'date' : 'datetime-local'"
          :value="values[field.key] ?? ''"
          @input="set(field.key, $event.target.value)"
          @blur="touch(field.key)"
        />

        <!-- 下拉单选 -->
        <select
          v-else-if="field.type === 'select'"
          :id="`f_${uid}_${field.key}`"
          class="ya-select"
          :class="{ invalid: errors[field.key] }"
          :value="values[field.key] ?? ''"
          @change="set(field.key, $event.target.value)"
          @blur="touch(field.key)"
        >
          <option value="">请选择…</option>
          <option v-for="opt in field.options || []" :key="opt" :value="opt">{{ opt }}</option>
        </select>

        <!-- 单选按钮 -->
        <div v-else-if="field.type === 'radio'" class="options">
          <label v-for="opt in field.options || []" :key="opt" class="option" :data-on="values[field.key] === opt">
            <input
              type="radio"
              :name="`${uid}_${field.key}`"
              :value="opt"
              :checked="values[field.key] === opt"
              @change="set(field.key, opt)"
            />
            <span>{{ opt }}</span>
          </label>
        </div>

        <!-- 多选 -->
        <div v-else-if="field.type === 'checkbox'" class="options">
          <label
            v-for="opt in field.options || []"
            :key="opt"
            class="option"
            :data-on="(values[field.key] || []).includes(opt)"
          >
            <input
              type="checkbox"
              :value="opt"
              :checked="(values[field.key] || []).includes(opt)"
              @change="toggleMulti(field.key, opt)"
            />
            <span>{{ opt }}</span>
          </label>
        </div>

        <!-- 开关 -->
        <div v-else-if="field.type === 'switch'" class="ya-row" style="gap: 10px">
          <button
            type="button"
            class="ya-switch"
            :data-on="values[field.key] === true"
            :aria-pressed="values[field.key] === true"
            @click="set(field.key, values[field.key] !== true)"
          />
          <span class="ya-muted" style="font-size: 12.5px">
            {{ values[field.key] === true ? '是' : '否' }}
          </span>
        </div>

        <!-- 评分 -->
        <div v-else-if="field.type === 'rating'" class="rating">
          <button
            v-for="n in ratingRange(field)"
            :key="n"
            type="button"
            class="star"
            :data-on="Number(values[field.key]) >= n"
            :title="`${n} 分`"
            @click="set(field.key, n)"
          >
            ★
          </button>
          <span class="ya-muted" style="font-size: 12px">{{ values[field.key] || 0 }} / {{ field.max ?? 5 }}</span>
        </div>

        <p v-if="field.help" class="ya-help">{{ field.help }}</p>
        <p v-if="errors[field.key]" class="ya-error">⚠ {{ errors[field.key] }}</p>
      </div>
    </div>

    <div class="actions">
      <div class="progress">
        <div class="bar"><div class="bar-in" :style="{ width: `${Math.round(rate * 100)}%` }" /></div>
        <span class="ya-muted" style="font-size: 11.5px">必填完成度 {{ Math.round(rate * 100) }}%</span>
      </div>
      <div class="ya-row">
        <button type="button" class="ya-btn ya-btn-ghost" @click="resetAll">重置</button>
        <button type="submit" class="ya-btn ya-btn-primary" :disabled="!valid">
          {{ editing ? '💾 保存修改' : '＋ 提交记录' }}
        </button>
      </div>
    </div>
  </form>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { completionRate, validateRecord } from '@/engine/validate.js'
import { defaultValueFor } from '@/engine/spec.js'

const props = defineProps({
  entity: { type: Object, required: true },
  initial: { type: Object, default: null },
  editing: { type: Boolean, default: false },
})

const emit = defineEmits(['submit', 'cancel-edit'])

const uid = Math.random().toString(36).slice(2, 7)
const values = reactive(buildValues())
const touched = reactive({})
const submitTried = ref(false)

function buildValues() {
  const out = {}
  for (const f of props.entity.fields) {
    out[f.key] = props.initial?.values?.[f.key] ?? defaultValueFor(f)
  }
  return out
}

watch(
  () => props.initial,
  () => {
    const next = buildValues()
    Object.keys(next).forEach((k) => {
      values[k] = next[k]
    })
    Object.keys(touched).forEach((k) => delete touched[k])
    submitTried.value = false
  },
  { deep: true },
)

const validation = computed(() => validateRecord(props.entity, values))
const errors = computed(() => {
  const out = {}
  for (const [key, msg] of Object.entries(validation.value.errors)) {
    if (touched[key] || submitTried.value) out[key] = msg
  }
  return out
})
const valid = computed(() => validation.value.valid)
const rate = computed(() => completionRate(props.entity, values))

function set(key, value) {
  values[key] = value
}

function touch(key) {
  touched[key] = true
}

function toggleMulti(key, opt) {
  const arr = Array.isArray(values[key]) ? [...values[key]] : []
  const idx = arr.indexOf(opt)
  if (idx === -1) arr.push(opt)
  else arr.splice(idx, 1)
  values[key] = arr
}

function ratingRange(field) {
  const max = field.max ?? 5
  const min = field.min ?? 1
  const out = []
  for (let i = min; i <= max; i += 1) out.push(i)
  return out
}

function placeholderOf(field) {
  if (field.placeholder) return field.placeholder
  switch (field.type) {
    case 'number':
      return '请输入数字'
    case 'currency':
      return '0.00'
    case 'phone':
      return '11 位手机号'
    case 'email':
      return 'name@example.com'
    case 'textarea':
      return '请补充说明…'
    default:
      return `请输入${field.label}`
  }
}

function resetAll() {
  for (const f of props.entity.fields) values[f.key] = defaultValueFor(f)
  Object.keys(touched).forEach((k) => delete touched[k])
  submitTried.value = false
}

function onSubmit() {
  submitTried.value = true
  if (!validation.value.valid) return
  emit('submit', JSON.parse(JSON.stringify(values)))
  if (!props.editing) resetAll()
}
</script>

<style scoped>
.dyn-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4) var(--space-5);
}

.wide {
  grid-column: 1 / -1;
}

.invalid {
  border-color: var(--danger-500) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger-500) 14%, transparent);
}

.num-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.prefix,
.suffix {
  position: absolute;
  font-size: 12.5px;
  color: var(--text-muted);
  pointer-events: none;
}

.prefix {
  left: 12px;
}

.suffix {
  right: 12px;
}

.has-prefix {
  padding-left: 26px;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 12.5px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--dur) var(--ease-out);
}

.option:hover {
  border-color: var(--brand-400);
}

.option[data-on='true'] {
  border-color: var(--brand-500);
  background: var(--brand-50);
  color: var(--brand-700);
  font-weight: 600;
}

:root[data-theme='dark'] .option[data-on='true'] {
  color: var(--brand-300);
}

.option input {
  display: none;
}

.rating {
  display: flex;
  align-items: center;
  gap: 4px;
}

.star {
  font-size: 20px;
  line-height: 1;
  color: var(--border-strong);
  transition: transform var(--dur) var(--ease-spring), color var(--dur);
}

.star[data-on='true'] {
  color: var(--warn-500);
}

.star:hover {
  transform: scale(1.15);
}

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px dashed var(--border);
}

.progress {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 180px;
}

.bar {
  height: 5px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  overflow: hidden;
}

.bar-in {
  height: 100%;
  border-radius: var(--radius-full);
  background: linear-gradient(90deg, var(--brand-500), var(--accent-500));
  transition: width var(--dur-slow) var(--ease-out);
}

@media (max-width: 720px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
