/**
 * Yours App (YA) · 对话意图识别
 * 从 agent.js 中独立出来，便于单元测试与多轮对话状态机复用。
 */

/** 生成/下发指令（比“确认”更强） */
const GENERATE_RE = /(确认并生成|开始生成|立即生成|马上生成|生成应用|构建应用|重建应用|生成吧|帮我生成|直接生成|出应用|落地应用)/

/** 修改类动词出现时，一律不视为确认 */
const MODIFY_RE = /(去掉|删除|移除|不要|取消|删掉|增加|新增|添加|加上|补充|再加|改成|改为|重命名|换成|修改|调整|变更)/

/** 确认词表（允许出现在句子任意位置，只要不是修改类意图） */
const CONFIRM_PATTERNS = [
  /^(可以|可以了|没问题|没问题的|行|好的|好|嗯|ok|okay|yes|y|继续|确定的|确认|就这样|就这样吧|这样吧|开始生成|生成吧|不用改了|没了|没有|无|挺好的|完美|对的|是的|进入下一步|下一步|next)\s*[!！。.~]*$/i,
  /(功能|清单|需求|这些|这个|方案|字段)?(都|全)?(没问题|可以了?|行了|ok了?)/i,
  /(继续|下一步|往下走|开始吧|生成吧|做吧|就这样)/,
  /^(不|无需|不用)(用)?(再)?(改|调整|修改)/,
]

/** 明确的否定：不要生成 */
const ABORT_RE = /(先不|暂时不|别生成|不要生成|取消生成|算了)/

/** 标点与语气词清理 */
function clean(text) {
  return String(text || '')
    .trim()
    .replace(/[！!。.~～,，、;；:：]+$/g, '')
    .replace(/\s+/g, '')
}

/**
 * 是否为「确认/继续」意图
 * @param {string} text
 */
export function detectConfirm(text) {
  const raw = String(text || '').trim()
  if (!raw) return false
  if (ABORT_RE.test(raw)) return false
  if (GENERATE_RE.test(raw)) return true
  if (MODIFY_RE.test(raw)) return false
  const t = clean(raw)
  return CONFIRM_PATTERNS.some((re) => re.test(t))
}

/** 是否包含明确的功能增删改意图 */
export function detectModify(text) {
  return MODIFY_RE.test(String(text || ''))
}

/** 是否在提问/求助 */
export function detectQuestion(text) {
  return /(怎么用|如何使用|能不能|是否|为什么|什么区别|帮助|教程|是什么)/.test(String(text || ''))
}

export const INTENT = {
  CONFIRM: 'confirm',
  MODIFY: 'modify',
  QUESTION: 'question',
  DESCRIBE: 'describe',
}

/** 综合判断 */
export function detectIntent(text) {
  if (detectConfirm(text)) return INTENT.CONFIRM
  if (detectModify(text)) return INTENT.MODIFY
  if (detectQuestion(text)) return INTENT.QUESTION
  return INTENT.DESCRIBE
}
