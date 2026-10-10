/**
 * Yours App (YA) · 功能清单指令服务
 * ------------------------------------------------------------------
 * 「用一句中文改动功能清单」这件事既可能发生在详情页的编辑器里（组件内直接调用），
 * 也可能发生在对话工作台里，因此把它收敛到一个无 UI 依赖的服务函数：
 *   - 同步执行，返回真实执行结果（Vue 的 emit 不返回值，不能在父子组件间传结果）
 *   - 组件在更新自己状态后只需再 emit 一个信号，让父级重算预览
 */

import { applyFeatureInstruction, compileSpecFromFeatureList, dedupeFeatures } from '@/engine/localEngine.js'

/**
 * @param {object} params
 * @param {import('pinia').Store} params.chat useChatStore() 实例
 * @param {string} params.text 用户指令
 * @param {string} [params.context] 业务语境（通常是应用名 + 描述）
 * @returns {{notes:string[], changed:boolean, featureList:Array, spec:object}}
 */
export function applyFeatureText({ chat, text, context }) {
  const plan = chat.planInstruction(text, context)
  chat.commitInstruction(plan, context)
  const featureList = chat.featureList.map((f) => ({ ...f }))
  return {
    notes: plan.notes || [],
    changed: Boolean(plan.changed),
    featureList,
    spec: chat.spec,
  }
}

/** 直接编辑功能清单（增删改单条）后重新编译 Spec */
export function updateFeatureList({ chat, list, context }) {
  const spec = chat.setFeatureList(list, context)
  return { featureList: chat.featureList.map((f) => ({ ...f })), spec }
}

/** 仅重编译（功能清单未变，但需要最新的 Spec 结构） */
export function recompileSpec({ chat, baseText, intentTexts, previousSpec }) {
  return chat.recompile({ baseText, intentTexts, previousSpec })
}

export { applyFeatureInstruction, compileSpecFromFeatureList, dedupeFeatures }
