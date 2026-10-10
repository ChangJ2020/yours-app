/**
 * Yours App (YA) · Agent 编排层
 * ------------------------------------------------------------------
 * 统一「LLM 优先 / 本地兜底」两条生成路径，并负责：
 *  - 阶段状态机（需求描述 → 功能清单 → 详细规格 → 应用运行）
 *  - 多轮对话文本生成
 *  - 确认后把功能清单编译成可运行的 App Spec
 * 所有对外方法都返回可直接渲染的消息对象，方便上层组件保持无逻辑。
 */

import {
  QUICK_IDEAS,
  applyFeatureInstruction,
  compileSpecFromFeatureList,
  dedupeFeatures,
  generateFeatureList,
} from './localEngine.js'
import { runAgentTurn } from './llmClient.js'
import { detectConfirm } from './intent.js'
import { normalizeSpec, uid } from './spec.js'

export const STEPS = [
  { key: 'describe', index: 0, title: '需求描述', hint: '用一句话说明你想管理什么业务' },
  { key: 'features', index: 1, title: '功能清单对齐', hint: '增删改功能，直到符合预期' },
  { key: 'spec', index: 2, title: '详细 Spec 确认', hint: '确认页面与字段定义' },
  { key: 'running', index: 3, title: '应用生成与运行', hint: '开始使用与二次迭代' },
]

/* ----------------------------- 意图识别规则 ----------------------------- */

/** 判断用户本轮输入是否为确认指令（规则集中在 intent.js，便于测试） */
export const isConfirm = detectConfirm

/** 关键词 → 快捷操作建议 */
export function suggestionsFor(stage, featureList = []) {
  if (stage === 'describe') {
    return QUICK_IDEAS.slice(0, 4).map((q) => ({ label: `${q.icon} ${q.label}`, value: q.text }))
  }
  if (stage === 'features' || stage === 'spec') {
    const base = [
      { label: '➕ 增加月度统计功能', value: '增加记录月度汇总统计的功能' },
      { label: '➕ 增加导出功能', value: '增加导出 Excel 的功能' },
      { label: '✏️ 增加一个字段', value: '增加一个"负责人"字段' },
    ]
    if (featureList.length > 2) base.push({ label: '➖ 去掉最后一项功能', value: `去掉"${featureList[featureList.length - 1].title}"` })
    base.push({ label: '✅ 没问题，继续', value: '功能没问题，继续' })
    return base
  }
  return [
    { label: '➕ 增加一个字段', value: '在表单里增加一个"加班类型"字段' },
    { label: '📊 增加统计视图', value: '增加数据汇总统计功能' },
  ]
}

/** 判断用户本轮输入是否为确认指令 */

/* ------------------------------ 本地话术模板 ----------------------------- */

const bullet = (list, mapper) => list.map((item, i) => `${i + 1}. ${mapper(item)}`).join('\n')

function featureChecklist(featureList) {
  return bullet(featureList, (f) => `${f.icon || '📌'} **${f.title}**：${f.description}`)
}

function specOverview(spec) {
  const lines = []
  for (const page of spec.pages || []) {
    const entity = spec.entities.find((e) => e.entityId === page.targetEntity)
    const typeLabel = page.pageType === 'form' ? '填写表单' : '数据表格'
    lines.push(`**${page.pageTitle}**（${typeLabel}）`)
    if (page.pageType === 'form' && entity) {
      lines.push(
        entity.fields
          .map((f) => `   • ${f.label}（${typeName(f.type)}${f.required ? '，必填' : ''}）`)
          .join('\n'),
      )
    } else if (entity) {
      lines.push(`   • 展示字段：${entity.fields.map((f) => f.label).join('、')}`)
      const caps = []
      if (page.features?.includes('search')) caps.push('关键词搜索')
      if (page.features?.includes('filter')) caps.push('条件筛选')
      if (page.features?.includes('export_csv')) caps.push('导出 CSV')
      if (page.features?.includes('delete_row')) caps.push('删除记录')
      if (page.features?.includes('edit_row')) caps.push('编辑记录')
      if (page.features?.includes('chart')) caps.push('汇总统计')
      if (caps.length) lines.push(`   • 支持：${caps.join('、')}`)
    }
  }
  return lines.join('\n')
}

function typeName(type) {
  return (
    {
      text: '文本', textarea: '多行文本', number: '数字', date: '日期', datetime: '日期时间',
      select: '单选', radio: '单选', checkbox: '多选', switch: '开关', email: '邮箱',
      phone: '手机号', rating: '评分', currency: '金额',
    }[type] || '文本'
  )
}

/* --------------------------------- 主流程 -------------------------------- */

export function greetingMessage() {
  return {
    id: uid('msg'),
    role: 'assistant',
    content:
      '你好！我是 YA 的应用架构师 👋\n\n告诉我你想要一个什么应用，用日常说话的方式描述就行。\n例如：\n• 我需要一个记录员工工时和加班的 App\n• 帮我做个简易的库存出入库管理\n\n描述后我会先给你一份功能清单，你确认或修改，再生成可以马上使用的应用。',
    at: Date.now(),
  }
}

/**
 * 阶段 1 → 2：根据用户描述生成功能清单
 */
export function respondToDescription(text) {
  const raw = String(text || '').trim()
  const draft = generateFeatureList(raw)
  const analysis = draft.analysis
  // 把用户原始描述一并带上：后续每一次重编译都要靠它保持业务领域不漂移
  const draftWithRaw = { ...draft, raw }
  const lines = [
    `明白了，你想做的是一个「**${draft.appName}**」这类工具，核心是围绕「${analysis.entityName}」做登记与查询。`,
    '',
    '我为你规划了这些功能：',
    featureChecklist(draft.featureList),
    '',
    '需要调整就直接说，比如「增加月度优秀员工功能」「去掉审核步骤」；',
    '如果没问题，回复「**功能没问题，继续**」，我就把页面和字段细化给你确认。',
  ]
  return {
    message: { id: uid('msg'), role: 'assistant', content: lines.join('\n'), at: Date.now() },
    draft: draftWithRaw,
  }
}

/** 阶段 2/3：功能清单增删改后的回应 */
export function respondToFeatureInstruction({ featureList, text, draft }) {
  const { featureList: nextList, notes, changed } = applyFeatureInstruction({ featureList, text, baseText: draft?.raw || text })
  const content = [
    changed ? `${notes.join('；')}。` : notes.join('；') || '好的，已记录你的调整。',
    '',
    '最新功能清单：',
    featureChecklist(nextList),
    '',
    '还需要调整继续说；回复「**没问题，继续**」我就细化为页面与字段。',
  ].join('\n')
  return {
    message: { id: uid('msg'), role: 'assistant', content, at: Date.now() },
    featureList: dedupeFeatures(nextList),
    changed,
  }
}

/** 阶段 2 → 3：产出详细规格 */
export function respondToConfirmation({ featureList, draft }) {
  const spec = compileSpecFromFeatureList({
    featureList,
    baseText: draft?.raw || '',
    appName: draft?.appName,
    icon: draft?.icon,
    description: draft?.description,
  })
  const content = [
    '好的，按这份功能清单，我把页面和字段细化如下：',
    '',
    specOverview(spec),
    '',
    '确认无误就点击下方「**🚀 确认并生成应用**」；需要改字段或页面，直接告诉我（例如「增加加班类型字段」「去掉备注」）。',
  ].join('\n')
  return { message: { id: uid('msg'), role: 'assistant', content, at: Date.now() }, spec }
}

/** 生成完成提示 */
export function respondToGeneration(spec) {
  return {
    id: uid('msg'),
    role: 'assistant',
    content: `应用构建成功！🎉\n\n「**${spec.appName}**」v${spec.version} 已就绪，包含 ${spec.entities[0].fields.length} 个字段、${spec.pages.length} 个页面。\n\n你可以在下方卡片进入应用开始填报数据；之后想加功能，在应用详情页说一句就行。`,
    at: Date.now(),
    tone: 'success',
  }
}

/** 迭代场景：生成新的 Spec */
export function buildIteratedSpec({ currentSpec, featureList, draft }) {
  const spec = compileSpecFromFeatureList({
    featureList,
    baseText: draft?.raw || currentSpec.description || '',
    appName: currentSpec.appName,
    icon: currentSpec.icon,
    description: currentSpec.description,
    previousSpec: currentSpec,
    appId: currentSpec.appId,
  })
  return normalizeSpec(spec, currentSpec)
}

/**
 * 调用模型完成一轮对话。
 * 成功：{ ok:true, mode:'llm', text, specDraft, model, latencyMs, usage }
 * 失败：{ ok:false, mode:'llm-error', error, kind } —— 由调用方决定如何提示/降级，本层不静默吞掉错误。
 */
export async function tryLlmTurn({ config, stage, history, userText, currentSpec, featureList, wantSpec, onDelta, signal }) {
  try {
    const result = await runAgentTurn({ config, stage, history, userText, currentSpec, featureList, wantSpec, onDelta, signal })
    return { ok: true, mode: 'llm', ...result }
  } catch (error) {
    return {
      ok: false,
      mode: 'llm-error',
      error: error?.message || String(error),
      kind: error?.kind || 'unknown',
      latencyMs: 0,
    }
  }
}

export { QUICK_IDEAS, compileSpecFromFeatureList, generateFeatureList, normalizeSpec }
