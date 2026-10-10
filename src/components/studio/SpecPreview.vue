<template>
  <div class="spec-preview">
    <!-- 实体与字段 -->
    <section class="block">
      <header class="block-head">
        <div>
          <div class="block-title">
            📦 数据表：{{ entity.entityName }}
            <span class="ya-badge ya-badge-mono">{{ entity.entityId }}</span>
          </div>
          <div class="block-sub">共 {{ entity.fields.length }} 个字段 · 点击字段名可直接修改</div>
        </div>
        <button class="ya-btn ya-btn-ghost ya-btn-sm" @click="emit('add-field')">＋ 添加字段</button>
      </header>

      <div class="fields">
        <FieldEditor
          v-for="field in entity.fields"
          :key="field.key"
          :field="field"
          :changed="changedKeys.includes(field.key)"
          :expanded="expandedKey === field.key"
          @patch="(p) => onPatch(field.key, p)"
          @remove="emit('remove-field', field.key)"
        />
      </div>

      <div v-if="removedFields.length" class="removed">
        <div class="ya-label">🗑️ 待移除字段（重新构建后历史数据将进入归档区）</div>
        <div class="chips">
          <span v-for="f in removedFields" :key="f.key" class="chip danger">
            {{ f.label }} <i>{{ FIELD_TYPE_MAP[f.type]?.label }}</i>
          </span>
        </div>
      </div>
    </section>

    <!-- 页面 -->
    <section class="block">
      <header class="block-head">
        <div>
          <div class="block-title">🖥️ 页面（{{ spec.pages.length }}）</div>
          <div class="block-sub">页面结构随功能清单自动推导</div>
        </div>
      </header>

      <div class="pages">
        <div v-for="page in spec.pages" :key="page.pageId" class="page" :data-new="addedPages.includes(page.pageId)">
          <div class="page-icon">{{ page.pageType === 'form' ? '📝' : '📊' }}</div>
          <div class="ya-grow">
            <div class="page-title">
              {{ page.pageTitle }}
              <span class="ya-badge">{{ page.pageType === 'form' ? '表单视图' : '表格视图' }}</span>
              <span v-if="addedPages.includes(page.pageId)" class="ya-badge ya-badge-ok">新增</span>
            </div>
            <div class="page-caps">
              <template v-if="page.pageType === 'form'">
                <span v-for="f in entity.fields" :key="f.key" class="cap">{{ f.label }}</span>
              </template>
              <template v-else>
                <span v-for="cap in page.features || []" :key="cap" class="cap">{{ FEATURE_LABEL[cap] || cap }}</span>
              </template>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 原始结构 -->
    <section class="block">
      <header class="block-head">
        <div>
          <div class="block-title">🧬 Spec 结构数据</div>
          <div class="block-sub">
            这就是驱动整个应用的「说明书」，共 {{ fieldCount }} 字段 / {{ spec.pages.length }} 页面；
            当前已有 {{ recordCount }} 条数据保存在本地
          </div>
        </div>
        <div class="ya-row">
          <button class="ya-btn ya-btn-quiet ya-btn-sm" @click="showJson = !showJson">
            {{ showJson ? '收起' : '查看' }}
          </button>
          <button class="ya-btn ya-btn-ghost ya-btn-sm" @click="copyJson">📋 复制</button>
        </div>
      </header>
      <pre v-if="showJson" class="json">{{ json }}</pre>
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import FieldEditor from './FieldEditor.vue'
import { FIELD_TYPE_MAP } from '@/engine/spec.js'
import { toast } from '@/composables/useToast.js'

const props = defineProps({
  spec: { type: Object, required: true },
  entity: { type: Object, required: true },
  changedKeys: { type: Array, default: () => [] },
  removedFields: { type: Array, default: () => [] },
  addedPages: { type: Array, default: () => [] },
  recordCount: { type: Number, default: 0 },
})

const emit = defineEmits(['patch-field', 'add-field', 'remove-field'])

const showJson = ref(false)
const expandedKey = ref('')

const FEATURE_LABEL = {
  filter: '条件筛选',
  search: '关键词搜索',
  export_csv: '导出 CSV',
  delete_row: '删除记录',
  edit_row: '编辑记录',
  chart: '汇总统计',
}

const fieldCount = computed(() => props.spec.entities.reduce((acc, e) => acc + e.fields.length, 0))

const json = computed(() =>
  JSON.stringify(
    {
      appName: props.spec.appName,
      version: props.spec.version,
      entities: props.spec.entities.map((e) => ({
        entityId: e.entityId,
        entityName: e.entityName,
        fields: e.fields.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
          ...(f.options ? { options: f.options } : {}),
          ...(f.min !== undefined ? { min: f.min } : {}),
          ...(f.max !== undefined ? { max: f.max } : {}),
        })),
      })),
      pages: props.spec.pages.map((p) => ({
        pageId: p.pageId,
        pageTitle: p.pageTitle,
        pageType: p.pageType,
        targetEntity: p.targetEntity,
        ...(p.features?.length ? { features: p.features } : {}),
      })),
      featureList: props.spec.featureList?.map((f) => ({ id: f.id, title: f.title, description: f.description })),
    },
    null,
    2,
  ),
)

function onPatch(key, patch) {
  emit('patch-field', key, patch)
  if (patch.label !== undefined || patch.type !== undefined) expandedKey.value = key
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(json.value)
    toast.ok('Spec 结构已复制到剪贴板')
  } catch {
    toast.warn('浏览器拒绝了剪贴板访问，请手动选择复制')
  }
}
</script>

<style scoped>
.spec-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.block {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  overflow: hidden;
}

.block-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 11px 13px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
}

.block-title {
  font-size: 13px;
  font-weight: 650;
  display: flex;
  align-items: center;
  gap: 7px;
}

.block-sub {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 2px;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 11px;
}

.removed {
  padding: 0 11px 11px;
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
  font-size: 11.5px;
  padding: 3px 9px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  color: var(--text-secondary);
}

.chip i {
  font-style: normal;
  font-size: 9.5px;
  color: var(--text-muted);
}

.chip.danger {
  background: var(--danger-50);
  color: var(--danger-600);
  text-decoration: line-through;
}

.pages {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px;
}

.page {
  display: flex;
  gap: 10px;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}

.page[data-new='true'] {
  border-color: color-mix(in srgb, var(--ok-500) 45%, transparent);
  animation: ya-pop 320ms var(--ease-spring) both;
}

.page-icon {
  width: 30px;
  height: 30px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--bg-subtle);
}

.page-title {
  font-size: 13px;
  font-weight: 620;
  display: flex;
  align-items: center;
  gap: 7px;
}

.page-caps {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 5px;
}

.cap {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  color: var(--text-muted);
}

.json {
  margin: 0;
  padding: 12px 14px;
  max-height: 260px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--bg-sunken);
  white-space: pre;
}
</style>
