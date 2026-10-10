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
import { LlmError } from '@/engine/llmClient.js'
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
  /** 用户在本应用上说过的所有需求原文（用于字段推导，绝不含应用描述本身） */
  const instructionLog = ref([])

  /* ---- AI 调用状态（用于界面提示与重试） ---- */
  const lastError = ref(null) // { kind, message, hint, userText, at }
  const aiStatus = ref('idle') // idle | requesting | streaming | parsing | done | error
  /** 最近一次错误文案（保留给旧版界面读数，等价于 lastError.message） */
  const errorMsg = ref('')
  const lastTurnMeta = ref(null) // { model, latencyMs, usage, mode }
  let abortController = null

  const stepIndex = computed(() => STEP_ORDER.indexOf(stepKey.value))
  const steps = computed(() =>
    STEPS.map((s) => ({
      ...s,
      state: s.index < stepIndex.value ? 'done' : s.index === stepIndex.value ? 'active' : 'todo',
    })),
  )
  const canGenerate = computed(() => Boolean(spec.value) && stepKey.value !== 'running')
  const suggestions = computed(() => suggestionsFor(stepKey.value, featureList.value))
  /** 是否走真实模型（用户可一键切回内置引擎） */
  const usingLlm = computed(() => settings.aiMode)
  const canRetry = computed(() => Boolean(lastError.value?.userText))

  function reset() {
    messages.value = [greetingMessage()]
    stepKey.value = 'describe'
    draft.value = null
    featureList.value = []
    spec.value = null
    createdApp.value = null
    streamingText.value = ''
    modeNote.value = ''
    instructionLog.value = []
    lastError.value = null
    aiStatus.value = 'idle'
    lastTurnMeta.value = null
    abortGeneration()
  }

  function push(message) {
    messages.value.push(message)
  }

  function pushUser(text) {
    push({ id: uid('msg'), role: 'user', content: text, at: Date.now() })
  }

  /** 中断当前生成 */
  function abortGeneration() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  /** 记录一次失败，供界面展示与「重试」使用 */
  function recordError(error, userText) {
    const kind = error instanceof LlmError ? error.kind : 'unknown'
    lastError.value = {
      kind,
      message: error?.message || String(error),
      hint: settings.errorHint(kind),
      userText,
      at: Date.now(),
    }
    errorMsg.value = lastError.value.message
    aiStatus.value = 'error'
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
   * - AI 模式：每轮都真实调用模型（流式），失败不静默回退，而是抛出可见错误 + 可重试 / 可手动降级
   * - 内置引擎模式：走本地规则引擎（离线可用）
   * @param {string} rawText
   * @param {object} [options]
   * @param {boolean} [options.retry] 标记为重试（不重复插入用户气泡）
   * @returns {Promise<{created: object|null, error: object|null}>}
   */
  async function send(rawText, { retry = false } = {}) {
    const text = String(rawText || '').trim()
    if (!text || thinking.value) return { created: null, error: null }

    lastError.value = null
    errorMsg.value = ''
    if (!retry) pushUser(text)

    const wantSpec =
      (stepKey.value === 'features' || stepKey.value === 'spec') && isConfirm(text) && Boolean(featureList.value.length)

    /* ------------------ AI 模式：真实调用模型 ------------------ */
    if (usingLlm.value) {
      thinking.value = true
      aiStatus.value = 'requesting'
      streamingText.value = ''
      const startedAt = Date.now()
      const holder = { id: uid('msg'), role: 'assistant', content: '', at: Date.now(), streaming: true, mode: 'ai' }
      /** 把流式内容写回消息流。
       * 注意：Vue 默认不做深响应，直接改 holder 上的字段不会触发重渲染，
       * 必须替换 messages 数组中的那一项（这里踩过坑）。 */
      const syncHolder = (patch = {}) => {
        const next = { ...holder, ...patch }
        const index = messages.value.findIndex((m) => m.id === holder.id)
        if (index === -1) messages.value.push(next)
        else messages.value[index] = next
      }
      abortController = new AbortController()

      try {
        // 注意：当前这条用户消息已经进入 messages，构造历史时必须排除，
        // 否则模型会收到两条一模一样的 user 消息（真实踩到的坑，用模拟服务抓包发现）
        const history = messages.value.slice(0, -1)
        const result = await tryLlmTurn({
          config: settings.effectiveLlm,
          stage: stepKey.value,
          history,
          userText: text,
          currentSpec: spec.value,
          featureList: featureList.value,
          wantSpec,
          signal: abortController.signal,
          onDelta: (delta) => {
            aiStatus.value = 'streaming'
            streamingText.value += delta
            syncHolder({ content: streamingText.value })
          },
        })

        if (!result?.ok) throw new LlmError(result?.error || '模型调用失败', 'unknown', result?.error)

        // 成功：一次性写回最终态（含模型名、耗时、token 统计），并结束流式标记
        const finalPatch = {
          streaming: false,
          content: result.text || streamingText.value,
          model: result.model || settings.effectiveLlm.model,
          latencyMs: result.latencyMs || Date.now() - startedAt,
          usage: result.usage || null,
          mode: 'ai',
        }
        syncHolder(finalPatch)
        holder.streaming = false
        holder.content = finalPatch.content

        lastTurnMeta.value = {
          model: finalPatch.model,
          latencyMs: finalPatch.latencyMs,
          usage: finalPatch.usage,
          mode: 'ai',
        }
        modeNote.value = `由 ${finalPatch.model} 生成 · ${(finalPatch.latencyMs / 1000).toFixed(1)}s`

        /* 模型给出结构化 Spec：直接采纳（校验后规范化） */
        if (result.specDraft) {
          aiStatus.value = 'parsing'
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
            draft.value = {
              raw: text,
              appName: normalized.appName,
              entityName: normalized.entities[0].entityName,
              icon: normalized.icon,
            }
          }
          // 模型给出结构化 Spec 后，流程推进：
          //   首次描述（describe）→ 进入功能清单阶段
          //   已在功能清单阶段（features）→ 说明需求已对齐，进入详细规格确认
          if (stepKey.value === 'describe') {
            stepKey.value = 'features'
          } else if (stepKey.value === 'features') {
            stepKey.value = 'spec'
            modeNote.value = `${modeNote.value} · 已进入详细规格确认`
          }
        } else if (stepKey.value === 'describe' && !featureList.value.length) {
          // 模型只回了文本、没给结构化数据：用内置引擎补一份功能清单，保证流程不卡住
          const d = generateFeatureList(text)
          draft.value = d
          featureList.value = d.featureList
          stepKey.value = 'features'
          holder.note = '已用内置引擎补充功能清单（模型本轮未输出结构化数据）'
        }
        if (!draft.value?.raw) {
          draft.value = { ...(draft.value || {}), raw: text }
        }
        aiStatus.value = 'done'
        // 关键：模型即使在这一轮就给出了完整 Spec，也不能直接生成应用 ——
        // 必须等用户明确确认（阶段 3 的确认语句，或点击「确认并生成应用」按钮）。
        // 否则「第一句话说完应用就自己建好了」，与 PRD 的 4 步确认流程不符。
        if (isConfirm(text) && stepKey.value === 'spec' && spec.value) {
          const app = finalize()
          return { created: app, error: null }
        }
        return { created: null, error: null }
      } catch (e) {
        // 失败：移除「正在流式输出」的占位气泡，改为一条可见的错误消息
        messages.value = messages.value.filter((m) => m.id !== holder.id)
        const isAbort = e?.kind === 'aborted' || e?.name === 'AbortError'
        recordError(e, text)
        push({
          id: uid('msg'),
          role: 'assistant',
          content: isAbort
            ? '已停止本次生成。'
            : `调用模型失败：${e?.message || e}\n\n> ${settings.errorHint(e?.kind)}`,
          at: Date.now(),
          tone: isAbort ? 'default' : 'error',
          errorKind: e?.kind || 'unknown',
        })
        return { created: null, error: lastError.value }
      } finally {
        thinking.value = false
        streamingText.value = ''
        abortController = null
      }
    }

    /* ------------------ 内置引擎模式（离线） ------------------ */
    modeNote.value = '内置引擎模式（未调用模型）'
    aiStatus.value = 'done'
    const created = advanceLocally(text)
    return { created, error: null }
  }

  /** 重试上一次失败的请求 */
  async function retryLast() {
    const text = lastError.value?.userText
    if (!text) return { created: null, error: null }
    // 移除上次的错误气泡，避免堆叠
    const last = messages.value[messages.value.length - 1]
    if (last?.role === 'assistant' && last.errorKind) messages.value.pop()
    return send(text, { retry: true })
  }

  /** 用户选择用内置引擎继续（显式降级，而不是静默回退） */
  async function fallbackToLocal() {
    const text = lastError.value?.userText
    settings.setAiMode(false)
    const last = messages.value[messages.value.length - 1]
    if (last?.role === 'assistant' && last.errorKind) messages.value.pop()
    if (!text) return { created: null, error: null }
    modeNote.value = '已切换到内置引擎模式'
    const created = advanceLocally(text)
    return { created, error: null }
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
          config: settings.effectiveLlm,
          stage: 'iterate',
          history: messages.value.slice(0, -1),
          userText: raw,
          currentSpec: spec.value,
          featureList: nextList,
          wantSpec: false,
        })
        if (result?.ok && result.text) commentary = result.text
        else if (result && !result.ok) modeNote.value = `模型调用失败（${result.error || '未知原因'}），本次说明由内置引擎生成`
      } catch (e) {
        modeNote.value = `模型调用失败（${e?.message || e}），本次说明由内置引擎生成`
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
      mode: commentary ? 'ai' : 'local',
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
    // AI 调用可见状态
    aiStatus,
    lastError,
    lastTurnMeta,
    canRetry,
    reset,
    send,
    retryLast,
    fallbackToLocal,
    abortGeneration,
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
