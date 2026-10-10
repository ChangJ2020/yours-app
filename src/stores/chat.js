import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  STEPS,
  buildIteratedSpec,
  greetingMessage,
  isConfirm,
  respondToConfirmation,
  respondToDescription,
  respondToFeatureInstruction,
  respondToGeneration,
  suggestionsFor,
  tryLlmTurn,
} from '@/engine/agent.js'
import { compileSpecFromFeatureList, dedupeFeatures, generateFeatureList, applyFeatureInstruction } from '@/engine/localEngine.js'
import { normalizeSpec, uid } from '@/engine/spec.js'
import { isLlmReady } from '@/engine/llmClient.js'
import { useSettingsStore } from './settings.js'

/** 阶段 key → 步骤下标 */
const STEP_ORDER = ['describe', 'features', 'spec', 'running']

export const useChatStore = defineStore('chat', () => {
  const settings = useSettingsStore()

  const messages = ref([])
  const stepKey = ref('describe')
  const draft = ref(null) // 需求解析结果（appName/entityName/raw）
  const featureList = ref([])
  const spec = ref(null) // 阶段 3 之后编译出的 Spec
  const thinking = ref(false)
  const streamingText = ref('')
  const modeNote = ref('')
  const createdApp = ref(null)
  const errorMsg = ref('')
  /** 用户在本应用上说过的所有需求原文（用于字段推导，绝不含应用描述本身） */
  const instructionLog = ref([])

  const stepIndex = computed(() => STEP_ORDER.indexOf(stepKey.value))
  const steps = computed(() =>
    STEPS.map((s) => ({
      ...s,
      state: s.index < stepIndex.value ? 'done' : s.index === stepIndex.value ? 'active' : 'todo',
    })),
  )
  const canGenerate = computed(() => Boolean(spec.value) && stepKey.value !== 'running')
  const suggestions = computed(() => suggestionsFor(stepKey.value, featureList.value))
  const usingLlm = computed(() => isLlmReady(settings.llm))

  function reset() {
    messages.value = [greetingMessage()]
    stepKey.value = 'describe'
    draft.value = null
    featureList.value = []
    spec.value = null
    createdApp.value = null
    streamingText.value = ''
    modeNote.value = ''
    errorMsg.value = ''
    instructionLog.value = []
  }

  function push(message) {
    messages.value.push(message)
  }

  function pushUser(text) {
    push({ id: uid('msg'), role: 'user', content: text, at: Date.now() })
  }

  /** 本地模式下的完整对话推进（返回生成的应用 Spec，若已生成） */
  function advanceLocally(text) {
    /* 阶段 0：需求描述 → 功能清单 */
    if (stepKey.value === 'describe' && !featureList.value.length) {
      const { message, draft: d } = respondToDescription(text)
      draft.value = d
      featureList.value = d.featureList
      stepKey.value = 'features'
      push(message)
      return null
    }

    /* 阶段 1/2：功能清单增删改 */
    if (stepKey.value === 'features') {
      if (isConfirm(text)) {
        const { message, spec: s } = respondToConfirmation({ featureList: featureList.value, draft: draft.value })
        spec.value = s
        stepKey.value = 'spec'
        push(message)
        return null
      }
      const { message, featureList: next } = respondToFeatureInstruction({
        featureList: featureList.value,
        text,
        draft: draft.value,
      })
      featureList.value = next
      push(message)
      return null
    }

    /* 阶段 2：详细规格 → 生成应用 */
    if (stepKey.value === 'spec') {
      if (isConfirm(text)) {
        return finalize()
      }
      // 视为对规格的自然语言微调：先改功能清单，再重编译
      const { featureList: next } = respondToFeatureInstruction({
        featureList: featureList.value,
        text,
        draft: draft.value,
      })
      featureList.value = next
      const recompiled = compileSpecFromFeatureList({
        featureList: next,
        baseText: draft.value?.raw || text,
        appName: spec.value?.appName || draft.value?.appName,
        icon: spec.value?.icon || draft.value?.icon,
        description: spec.value?.description || draft.value?.description,
        previousSpec: spec.value,
        appId: spec.value?.appId,
      })
      spec.value = recompiled
      push({
        id: uid('msg'),
        role: 'assistant',
        content: `已更新详细规格：\n\n${summarizeSpec(recompiled)}\n\n确认无误点「🚀 确认并生成应用」；还想改就继续说。`,
        at: Date.now(),
      })
      return null
    }

    return null
  }

  function summarizeSpec(s) {
    const entity = s.entities[0]
    const form = s.pages.find((p) => p.pageType === 'form')
    const table = s.pages.find((p) => p.pageType === 'table')
    return [
      `• 数据表：**${entity.entityName}**，共 ${entity.fields.length} 个字段`,
      form ? `• 填写页：**${form.pageTitle}**` : '',
      table ? `• 查询页：**${table.pageTitle}**` : '',
      `• 字段：${entity.fields.map((f) => f.label).join('、')}`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  /** 完成生成：编译最终 Spec 并写入消息流 */
  function finalize() {
    const final = normalizeSpec(spec.value || compileSpecFromFeatureList({ featureList: featureList.value, baseText: draft.value?.raw }))
    spec.value = final
    stepKey.value = 'running'
    push(respondToGeneration(final))
    createdApp.value = final
    return final
  }

  /**
   * 发送一条用户消息，推进对话状态机
   * @returns {Promise<{created: object|null}>}
   */
  async function send(rawText) {
    const text = String(rawText || '').trim()
    if (!text || thinking.value) return { created: null }
    errorMsg.value = ''
    pushUser(text)

    const wantSpec =
      (stepKey.value === 'features' || stepKey.value === 'spec') && isConfirm(text) && Boolean(featureList.value.length)

    /* ---------- 有模型时：走真实大模型（失败自动回退本地） ---------- */
    if (usingLlm.value) {
      thinking.value = true
      streamingText.value = ''
      const holder = { id: uid('msg'), role: 'assistant', content: '', at: Date.now(), streaming: true }
      try {
        const result = await tryLlmTurn({
          config: settings.llm,
          stage: stepKey.value,
          history: messages.value.slice(-12),
          userText: text,
          currentSpec: spec.value,
          featureList: featureList.value,
          wantSpec,
          onDelta: (delta) => {
            streamingText.value += delta
            if (!messages.value.includes(holder)) push(holder)
            holder.content = streamingText.value
          },
        })

        if (result?.ok) {
          holder.streaming = false
          holder.content = result.text || streamingText.value
          if (result.specDraft) {
            const normalized = normalizeSpec(
              {
                ...result.specDraft,
                featureList: dedupeFeatures(result.specDraft.featureList || featureList.value).map((f, i) => ({
                  ...f,
                  id: f.id || `feat_${i + 1}`,
                })),
              },
              spec.value || {},
            )
            spec.value = normalized
            if (Array.isArray(normalized.featureList) && normalized.featureList.length) {
              featureList.value = normalized.featureList
            }
            if (!draft.value) {
              draft.value = { raw: text, appName: normalized.appName, entityName: normalized.entities[0].entityName, icon: normalized.icon }
            }
            // 模型已经给出完整 Spec，视为可生成
            if (stepKey.value === 'describe') stepKey.value = 'features'
            if (!messages.value.includes(holder)) push(holder)
            if (isConfirm(text)) {
              const app = finalize()
              thinking.value = false
              streamingText.value = ''
              return { created: app }
            }
          } else if (stepKey.value === 'describe' && !featureList.value.length) {
            // 模型只回了文本：用本地引擎补一份功能清单，保证流程可继续
            const d = generateFeatureList(text)
            draft.value = d
            featureList.value = d.featureList
            stepKey.value = 'features'
          }
          if (!messages.value.includes(holder)) push(holder)
          modeNote.value = '由 AI 模型生成'
          thinking.value = false
          streamingText.value = ''
          return { created: null }
        }

        // 模型不可用：回退本地，并在消息里标注原因
        if (messages.value.includes(holder)) messages.value = messages.value.filter((m) => m !== holder)
        modeNote.value = `模型不可用，已回退内置引擎（${result?.error || '未配置'}）`
        errorMsg.value = result?.error || ''
      } catch (e) {
        if (messages.value.includes(holder)) messages.value = messages.value.filter((m) => m !== holder)
        modeNote.value = `模型调用失败，已回退内置引擎（${e?.message || e}）`
        errorMsg.value = e?.message || String(e)
      } finally {
        thinking.value = false
        streamingText.value = ''
      }
    }

    /* ---------- 本地规则引擎 ---------- */
    const created = advanceLocally(text)
    if (created) return { created }
    return { created: null }
  }

  /** 点击「确认并生成应用」按钮 */
  function confirmAndGenerate() {
    if (!featureList.value.length) return null
    if (stepKey.value === 'features') {
      const { message, spec: s } = respondToConfirmation({ featureList: featureList.value, draft: draft.value })
      spec.value = s
      stepKey.value = 'spec'
      push(message)
      return null
    }
    if (stepKey.value === 'spec') return finalize()
    return null
  }

  /**
   * 工作室：本地重编译 Spec（功能清单变化后的联动）
   * @param {object} [options]
   * @param {string} [options.baseText] 业务语境（通常是应用描述）
   * @param {string[]} [options.intentTexts] 用户按顺序说过的所有需求原文
   * @param {object} [options.previousSpec] 以哪一版 Spec 为基线（工作室传入自己加载的那一版，
   *        避免依赖对话状态，保证重编译结果始终可预期）
   */
  function recompile({ baseText, intentTexts = [], previousSpec } = {}) {
    const base = previousSpec || spec.value
    const next = compileSpecFromFeatureList({
      featureList: featureList.value,
      baseText: baseText || draft.value?.raw || '',
      // 只把「用户真正说过的话」当作意图，绝不使用应用描述，
      // 否则描述里的词会把用户已删除的字段重新推导回来
      intentText: intentTexts.filter(Boolean).join(' '),
      appName: base?.appName || draft.value?.appName,
      icon: base?.icon || draft.value?.icon,
      description: base?.description || draft.value?.description,
      previousSpec: base || null,
      appId: base?.appId,
    })
    spec.value = next
    return next
  }

  /** 工作室：直接编辑功能清单 */
  function setFeatureList(list, context) {
    featureList.value = dedupeFeatures(list).map((f, i) => ({ ...f, id: f.id || `feat_${i + 1}` }))
    return recompile({ baseText: context, intentTexts: instructionLog.value })
  }

  /** 加载某个已有应用进入对话（用于「用 AI 迭代此 App」） */
  function loadApp(specInput) {
    const normalized = normalizeSpec(specInput, {})
    spec.value = normalized
    featureList.value = normalized.featureList?.length
      ? normalized.featureList
      : [
          { id: 'feat_1', icon: '📝', title: `${normalized.entities[0].entityName}填报`, description: '录入数据' },
          { id: 'feat_2', icon: '📋', title: `${normalized.entities[0].entityName}查询`, description: '查看与导出数据' },
        ]
    draft.value = {
      raw: normalized.description || normalized.appName,
      appName: normalized.appName,
      entityName: normalized.entities[0].entityName,
      icon: normalized.icon,
    }
    stepKey.value = 'running'
    messages.value = [
      {
        id: uid('msg'),
        role: 'assistant',
        content: `已载入「**${normalized.appName}**」v${normalized.version}。\n\n当前功能：\n${featureList.value
          .map((f, i) => `${i + 1}. ${f.icon || '📌'} ${f.title}：${f.description}`)
          .join('\n')}\n\n想加功能、加字段或改页面，直接说；例如「增加加班类型字段」「去掉审核步骤」。`,
        at: Date.now(),
      },
    ]
  }

  /**
   * 纯函数式：把一句话指令落到功能清单（同步、无副作用、不会卡住 UI）
   * @param {string} text 用户的增改指令
   * @param {string} [context] 业务语境（通常是当前应用的描述），领域识别与关键词命中都依赖它
   * @returns {{featureList:Array, notes:string[], changed:boolean, text:string}}
   */
  function planInstruction(text, context) {
    const plan = applyFeatureInstruction({
      featureList: featureList.value,
      text,
      baseText: context || draft.value?.raw || text,
    })
    // 记录本轮意图原文，供编译阶段判断「用户到底点名了什么」
    instructionLog.value = [...instructionLog.value, text].slice(-20)
    return { ...plan, text }
  }

  /** 应用计划结果（更新功能清单并重编译 Spec） */
  function commitInstruction(plan, context) {
    if (!plan) return featureList.value
    featureList.value = dedupeFeatures(plan.featureList)
    const next = compileSpecFromFeatureList({
      featureList: featureList.value,
      baseText: context || draft.value?.raw || '',
      intentText: instructionLog.value.join(' '),
      appName: spec.value?.appName || draft.value?.appName,
      icon: spec.value?.icon || draft.value?.icon,
      description: spec.value?.description || draft.value?.description,
      previousSpec: spec.value,
      appId: spec.value?.appId,
    })
    spec.value = next
    return featureList.value
  }

  /** 迭代：返回新的 Spec（不落库，由调用方决定是否重建） */
  function iterate({ currentSpec, text }) {
    const next = buildIteratedSpec({ currentSpec, featureList: featureList.value, draft: draft.value })
    if (text) {
      push({
        id: uid('msg'),
        role: 'assistant',
        content: `已按你的要求更新方案，右侧详细规格已同步刷新，点击「重新构建并运行应用」即可生效。`,
        at: Date.now(),
      })
    }
    return next
  }

  /**
   * 「用 AI 迭代此 App」的对话式入口：本地规则确定性地落地变更，
   * 若配置了模型则额外请模型润色说明文案（失败不影响结果）。
   * @returns {Promise<{featureList:Array, notes:string[], mode:string}>}
   */
  async function iterateWithText(text) {
    const raw = String(text || '').trim()
    if (!raw) return { featureList: featureList.value, notes: [], mode: 'local' }
    push({ id: uid('msg'), role: 'user', content: raw, at: Date.now() })

    const plan = planInstruction(raw)
    const nextList = commitInstruction(plan)
    const notes = plan.notes?.length ? plan.notes : ['未匹配到明确的功能改动，可换一种说法（例如「增加导出功能」）']

    let commentary = null
    if (usingLlm.value) {
      try {
        const result = await tryLlmTurn({
          config: settings.llm,
          stage: 'iterate',
          history: messages.value.slice(-10),
          userText: raw,
          currentSpec: spec.value,
          featureList: nextList,
          wantSpec: false,
        })
        if (result?.ok && result.text) commentary = result.text
        else if (result && !result.ok) modeNote.value = `模型不可用，已回退内置引擎（${result.error || '未配置'}）`
      } catch (e) {
        modeNote.value = `模型调用失败，已回退内置引擎（${e?.message || e}）`
      }
    }

    push({
      id: uid('msg'),
      role: 'assistant',
      content:
        commentary ||
        [
          notes.join('；'),
          '',
          '更新后的功能清单：',
          nextList.map((f, i) => `${i + 1}. ${f.icon || '📌'} ${f.title}：${f.description}`).join('\n'),
          '',
          '点击「✅ 应用到功能清单」，再在底部执行「重新构建并运行应用」即可生效。',
        ].join('\n'),
      at: Date.now(),
    })

    return { featureList: nextList, notes, mode: commentary ? 'llm' : 'local' }
  }

  return {
    messages,
    stepKey,
    stepIndex,
    steps,
    draft,
    featureList,
    spec,
    thinking,
    streamingText,
    modeNote,
    errorMsg,
    createdApp,
    canGenerate,
    suggestions,
    usingLlm,
    reset,
    send,
    confirmAndGenerate,
    recompile,
    setFeatureList,
    loadApp,
    iterate,
    planInstruction,
    commitInstruction,
    iterateWithText,
    push,
    summarizeSpec,
  }
})
