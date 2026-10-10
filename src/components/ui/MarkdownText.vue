<template>
  <div class="md" v-html="html" />
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  text: { type: String, default: '' },
})

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * 轻量 Markdown 渲染：只支持 Agent 实际会输出的子集
 * （粗体、行内代码、无序/有序列表、引用、代码块、换行）
 * 所有内容先转义再拼接标签，因此不存在注入风险。
 */
const html = computed(() => {
  const raw = String(props.text || '')
  const blocks = []

  // 1. 抽出代码块，避免被行内规则破坏
  let body = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = blocks.push(`<pre class="md-pre"><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`) - 1
    return `\u0000BLOCK${idx}\u0000`
  })

  body = escapeHtml(body)

  const lines = body.split('\n')
  const out = []
  let listType = null

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      closeList()
      out.push('<div class="md-gap"></div>')
      continue
    }

    const ol = trimmed.match(/^(\d+)[.、)]\s+(.*)$/)
    const ul = trimmed.match(/^[-•*]\s+(.*)$/)

    if (ol) {
      if (listType !== 'ol') {
        closeList()
        out.push('<ol class="md-ol">')
        listType = 'ol'
      }
      out.push(`<li>${inline(ol[2])}</li>`)
      continue
    }
    if (ul) {
      if (listType !== 'ul') {
        closeList()
        out.push('<ul class="md-ul">')
        listType = 'ul'
      }
      out.push(`<li>${inline(ul[1])}</li>`)
      continue
    }

    closeList()

    if (/^\|.*\|$/.test(trimmed)) {
      out.push(`<div class="md-quote">${inline(trimmed.replace(/^\||\|$/g, '').trim())}</div>`)
      continue
    }
    if (/^&gt;\s?/.test(trimmed)) {
      out.push(`<div class="md-quote">${inline(trimmed.replace(/^&gt;\s?/, ''))}</div>`)
      continue
    }
    out.push(`<p>${inline(trimmed)}</p>`)
  }
  closeList()

  let result = out.join('')
  result = result.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => blocks[Number(i)])
  return result
})

function inline(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1<em>$2</em>')
}
</script>

<style scoped>
.md {
  font-size: 13.5px;
  line-height: 1.72;
  word-break: break-word;
}

.md :deep(p) {
  margin: 0;
}

.md :deep(.md-gap) {
  height: 8px;
}

.md :deep(strong) {
  font-weight: 680;
  color: var(--text-primary);
}

.md :deep(.md-ol),
.md :deep(.md-ul) {
  margin: 6px 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.md :deep(.md-ol) {
  list-style: decimal;
}

.md :deep(.md-ul) {
  list-style: disc;
}

.md :deep(li) {
  padding-left: 2px;
}

.md :deep(li::marker) {
  color: var(--brand-500);
  font-weight: 600;
}

.md :deep(.md-code) {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-sunken);
  padding: 1px 5px;
  border-radius: 5px;
  border: 1px solid var(--border);
}

.md :deep(.md-quote) {
  padding: 2px 0 2px 10px;
  border-left: 2px solid var(--border-strong);
  color: var(--text-secondary);
  font-size: 13px;
}

.md :deep(.md-pre) {
  margin: 8px 0;
  padding: 12px 14px;
  background: var(--gray-900);
  color: #e2e8f0;
  border-radius: var(--radius-sm);
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
}

.md :deep(.md-pre code) {
  font-family: var(--font-mono);
}
</style>
