/**
 * Yours App (YA) · 本地生成引擎（内置规则 Agent）
 * ------------------------------------------------------------------
 * 不依赖外部模型即可跑通 PRD 的 4 步生成闭环：
 *   自然语言 → 业务领域识别 → 功能清单生成/增删改 → 详细 Spec 编译
 * 同时提供「原始需求 → 业务简报」的抽取能力，供人工确认与 LLM 复用。
 */

import {
  COMMON_FIELDS,
  DOMAINS,
  FIELD_KEYWORD_MAP,
  GENERIC_OPTIONALS,
  STOP_WORDS,
} from './vocabulary.js'
import { normalizeEntity, normalizeFeature, normalizePage, normalizeSpec, uid } from './spec.js'

/* ------------------------------- 文本工具 ------------------------------- */

const normalizeText = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** 命中关键词（中文无分词，直接包含匹配 + 英文按词边界） */
function hits(text, keyword) {
  const kw = String(keyword || '').toLowerCase()
  if (!kw) return false
  return text.includes(kw)
}

/** 统计命中次数（用于评分与字段补捞） */
function countHits(text, keyword) {
  const kw = String(keyword || '').toLowerCase()
  if (!kw) return 0
  let count = 0
  let idx = text.indexOf(kw)
  while (idx !== -1) {
    count += 1
    idx = text.indexOf(kw, idx + kw.length)
  }
  return count
}

/* --------------------------- 1. 领域识别与打分 --------------------------- */

/**
 * 对全部领域模板打分，返回降序结果
 * @param {string} text 用户原始描述
 */
export function scoreDomains(text) {
  const t = normalizeText(text)
  return DOMAINS.map((domain) => {
    let score = 0
    const matched = []
    for (const kw of domain.strongKeywords || []) {
      const n = countHits(t, kw)
      if (n) {
        score += 6 * n
        matched.push(kw)
      }
    }
    for (const kw of domain.keywords || []) {
      const n = countHits(t, kw)
      if (n) {
        score += 2.5 * n
        matched.push(kw)
      }
    }
    // 实体名整体出现权重更高
    if (hits(t, domain.entityName)) {
      score += 4
      matched.push(domain.entityName)
    }
    return { domain, score, matched: Array.from(new Set(matched)) }
  }).sort((a, b) => b.score - a.score)
}

/** 选出最匹配的领域，超出阈值则返回 null（走通用兜底） */
export function detectDomain(text, threshold = 2.5) {
  const [best] = scoreDomains(text)
  return best && best.score >= threshold ? best : null
}

/* ----------------------------- 2. 需求抽取 ------------------------------ */

/** 从描述中推断一个合适的 App 名称 */
function inferAppName(text, domain) {
  if (domain) return domain.name
  // 去除停用词后的核心名词短语
  let core = String(text || '')
  for (const w of STOP_WORDS) core = core.replace(new RegExp(w, 'gi'), '')
  core = core.replace(/[，。！？、,.!?；;：:"'“”‘’()（）\[\]【】]/g, ' ').replace(/\s+/g, ' ').trim()
  const words = core.split(' ').filter((w) => w.length >= 2)
  if (words.length) {
    const head = words.slice(0, 2).join('')
    return /管理|记录|登记|台账|清单|助手|系统/.test(head) ? head : `${head}管理助手`
  }
  return '我的业务管理助手'
}

/** 从描述中抽取出显式提到的字段（必须出现在「字段/列/列名/属性」等字段语境里） */
function extractExplicitFields(text) {
  const t = normalizeText(text)
  const found = []
  for (const entry of FIELD_KEYWORD_MAP) {
    const mentioned = entry.keywords.some((kw) =>
      // 形如「加班类型字段」「费用列」「字段：备注」才算显式字段需求，
      // 避免「工作内容描述」这类普通业务表述被误判成字段需求
      new RegExp(`${escapeRegExp(kw)}\\s*(字段|列|列名|属性|项)|(字段|列|列名|属性)\\s*[：:]?\\s*${escapeRegExp(kw)}`).test(t),
    )
    if (mentioned) found.push({ ...entry.field })
  }
  return found
}

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 需求简报：把一段自然语言拆成结构化理解结果，供用户确认（阶段 1 → 2 的桥）
 * @param {string} text
 */
export function analyzeRequirement(text) {
  const raw = String(text || '').trim()
  const detected = detectDomain(raw)
  const domain = detected?.domain || null
  const explicitFields = extractExplicitFields(raw)
  const extras = []
  if (domain) collectOptionals(domain, raw, extras)

  const entityName = domain?.entityName || inferEntityName(raw)
  return {
    raw,
    appName: inferAppName(raw, domain),
    icon: domain?.icon || '🧩',
    description: domain?.description || `用于${entityName}的轻量业务记录工具。`,
    domainId: domain?.id || 'generic',
    domainScore: detected?.score || 0,
    matchedKeywords: detected?.matched || [],
    entityName,
    explicitFields: explicitFields.map((f) => f.label),
    optionalTitles: extras.map((o) => o.title),
  }
}

/** 兜底实体名：取描述里的核心名词 */
function inferEntityName(text) {
  let core = String(text || '')
  for (const w of STOP_WORDS) core = core.replace(new RegExp(w, 'gi'), '')
  core = core.replace(/[^\w\u4e00-\u9fa5]/g, '').trim()
  return core ? core.slice(0, 8) : '业务记录'
}

/* ---------------------------- 3. 功能清单生成 ---------------------------- */

/** 把领域模板的可选功能按关键词勾选出来 */
function collectOptionals(domain, text, bucket = []) {
  const t = normalizeText(text)
  for (const opt of [...(domain?.optionals || []), ...GENERIC_OPTIONALS]) {
    if (opt.keywords.some((kw) => hits(t, kw))) bucket.push(opt)
  }
  return bucket
}

/** 用户显式说「不要/去掉/删除 X」时，剔除对应功能 */
function collectNegations(text, features) {
  const t = normalizeText(text)
  const negated = new Set()
  const negPatterns = [/(?:不要|不需要|去掉|删除|移除|取消|去掉)([^，。,.；;！!？?\s]{1,12})/g]
  const phrases = []
  for (const re of negPatterns) {
    let m = re.exec(t)
    while (m) {
      phrases.push(m[1])
      m = re.exec(t)
    }
  }
  if (!phrases.length) return features
  return features.filter((ft) => {
    const title = ft.title.toLowerCase()
    const hitNeg = phrases.some((p) => title.includes(p) || p.includes(title.slice(0, 2)))
    if (hitNeg) negated.add(ft.id)
    return !hitNeg
  })
}

/**
 * 生成功能清单
 * @param {string} text 用户需求描述
 * @returns {{appName:string, icon:string, description:string, domainId:string, featureList:Array, specDraft:object}}
 */
export function generateFeatureList(text) {
  const analysis = analyzeRequirement(text)
  const domain = DOMAINS.find((d) => d.id === analysis.domainId) || null

  /** @type {Array<{icon:string,title:string,description:string,effect?:string,fields?:any[]}>} */
  const seeds = []
  if (domain) {
    for (const [icon, title, description] of domain.features) seeds.push({ icon, title, description })
  } else {
    seeds.push(
      { icon: '📝', title: `${analysis.entityName}信息登记`, description: `通过表单录入${analysis.entityName}的基础信息` },
      { icon: '📋', title: `${analysis.entityName}明细查询`, description: `以表格汇总展示${analysis.entityName}并支持检索` },
    )
  }

  // 显式字段需求 → 追加一个「扩展字段登记」功能
  const explicitFields = extractExplicitFields(text)
  if (explicitFields.length >= 2) {
    seeds.push({
      icon: '🧩',
      title: `${explicitFields.map((f) => f.label).slice(0, 3).join('、')}等字段登记`,
      description: '按您的描述补充记录所需的关键字段',
      fields: explicitFields,
    })
  }

  // 关键词触发的可选功能
  const optionals = []
  if (domain) collectOptionals(domain, text, optionals)
  else collectOptionals({ optionals: [] }, text, optionals)
  for (const opt of optionals) seeds.push(opt)

  // 至少保证导出能力（PRD 要求）
  if (!optionals.some((o) => o.title.includes('导出'))) {
    seeds.push(GENERIC_OPTIONALS.find((o) => o.title.includes('导出')))
  }

  let featureList = dedupeFeatures(seeds).map((s, i) =>
    normalizeFeature({ id: `feat_${i + 1}`, icon: s.icon, title: s.title, description: s.description }, i),
  )

  const entityId = domain?.entityId || 'record'
  featureList = featureList.map((ft) => ({ ...ft, relatedEntityIds: [entityId] }))
  featureList = collectNegations(text, featureList)

  return {
    appName: analysis.appName,
    icon: analysis.icon,
    description: analysis.description,
    domainId: analysis.domainId,
    analysis,
    featureList,
  }
}

/** 功能去重 + 剔除空项 */
export function dedupeFeatures(list) {
  const seen = new Set()
  const out = []
  for (const item of list.filter(Boolean)) {
    const key = String(item.title || '').replace(/\s/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/* ---------------------------- 4. Spec 编译 ------------------------------ */

const FIELD_TYPE_LABEL = {
  text: '文本', textarea: '长文本', number: '数字', date: '日期', datetime: '时间',
  select: '单选', radio: '单选', checkbox: '多选', switch: '开关', email: '邮箱',
  phone: '手机', rating: '评分', currency: '金额',
}

/**
 * 由功能清单编译详细 Spec（PRD 第 3 章的核心联动：功能清单 → Spec）
 * @param {object} ctx
 * @param {Array} ctx.featureList 编辑后的功能清单
 * @param {string} [ctx.baseText] 原始需求描述（用于补捞字段）
 * @param {object} [ctx.previousSpec] 上一次的 Spec（用于迁移字段定义与页面特性）
 * @returns {object} 规范化后的 Spec（未落库）
 */
export function compileSpecFromFeatureList({
  featureList = [],
  baseText = '',
  intentText = '',
  appName,
  icon,
  description,
  previousSpec = null,
  appId,
  version,
}) {
  const t = normalizeText(baseText)
  // 「意图文本」只包含用户本轮真正说出口的话（不含应用描述），
  // 用于判断用户是否点名了某个可选功能/字段 —— 避免迭代时把已删字段又判定为「用户要的」
  const intent = normalizeText(intentText || baseText)
  const analysis = generateFeatureList(baseText)
  const isEvolve = Boolean(previousSpec)
  // 已有应用迭代时，业务领域应以「应用本身」为准，而不是重新猜一遍用户的原始描述
  const previousEntity = previousSpec?.entities?.[0]
  const domain =
    (isEvolve ? DOMAINS.find((d) => d.entityId === previousEntity?.entityId) : null) ||
    DOMAINS.find((d) => d.id === analysis.domainId) ||
    null

  /* --- 实体与字段 ---
   * 字段来源只有四条，且都可追溯（保证「用户删掉的字段不会复活」）：
   * 1. 已有 Spec 的字段：迭代时优先原样保留
   * 2. 领域模板核心字段 + 已选中可选功能的字段：仅首次创建时带入
   * 3. 本轮新加入功能自带的数据项（_newFields 瞬时上下文，编译后清除）
   * 4. 用户本轮明确点名的字段
   */
  const fieldMap = new Map() // label -> field
  const pushField = (field) => {
    if (!field?.label) return
    const key = field.label
    if (!fieldMap.has(key)) fieldMap.set(key, { ...field })
  }

  // 0) 迭代时先占位已有字段，避免被模板字段「复活」
  for (const f of previousSpec?.entities?.[0]?.fields || []) pushField(f)

  /* 已经被应用「消化」过的字段名：迭代时不再因为基础字段关键词（如描述里的「工作内容」）重复补入。
   * 关键点：用户删掉的字段不在这个集合里，因此不会被误判为「已满足」而复活。 */
  const satisfiedLabels = new Set()
  for (const f of previousSpec?.entities?.[0]?.fields || []) satisfiedLabels.add(f.label)
  for (const ft of featureList) {
    for (const f of ft._newFields || []) satisfiedLabels.add(f.label)
  }

  if (domain) {
    if (!isEvolve) {
      // 首次创建：领域模板的核心字段整体带入；
      // 标了 optional 的字段属于「可选功能」，必须命中对应功能后才带入
      domain.fields.filter((f) => f.group !== 'optional').forEach(pushField)
      for (const opt of domain.optionals || []) {
        const titleHit = featureList.some(
          (ft) => String(ft.title || '').includes(opt.title) || opt.title.includes(String(ft.title || '')),
        )
        if (titleHit) (opt.fields || []).forEach(pushField)
      }
    }

    /* 本轮新加入的功能：补上它的数据项 */
    for (const ft of featureList) {
      if (Array.isArray(ft._newFields)) ft._newFields.forEach(pushField)
    }

    /* 用户直接点名要某个字段（如「增加加班类型字段」）时，即使不提整个功能也要补上；
     * 已存在的字段视为已满足，不重复判定 */
    for (const opt of domain.optionals || []) {
      const alreadyOwned = (opt.fields || []).some((f) => satisfiedLabels.has(f.label))
      const fieldAsked = (opt.fields || []).some((f) => intent.includes(String(f.label).toLowerCase()))
      if (fieldAsked && !alreadyOwned) (opt.fields || []).forEach(pushField)
    }

    /* 跨领域点名：用户在本应用语境下要了别的领域的功能（如客户应用里要「月度优秀员工」）。
     * 只认功能标题，避免关键词（如「工时」）把无关领域的功能字段一起拖进来。 */
    for (const d of DOMAINS) {
      if (d.id === domain.id) continue
      for (const opt of d.optionals || []) {
        const titleHit = featureList.some((ft) => String(ft.title || '').includes(opt.title))
        if (titleHit) (opt.fields || []).forEach(pushField)
      }
    }
  } else if (!isEvolve) {
    pushField({ label: `${analysis.entityName}名称`, type: 'text', required: true })
    pushField({ label: '登记日期', type: 'date', required: true })
    pushField({ label: '负责人', type: 'text' })
  }

  // 显式字段语境（创造阶段）：如「需要一个记录工时的表，包含：姓名、日期」
  if (!isEvolve) extractExplicitFields(baseText).forEach(pushField)

  // 通用兜底：只有确实凑不出可用字段时才补（避免给已有完整结构的应用硬塞字段）
  if (fieldMap.size < 2) {
    pushField({ label: `${analysis.entityName}名称`, type: 'text', required: true })
    pushField({ label: '登记日期', type: 'date', required: true })
    if (fieldMap.size < 3) pushField({ label: '备注说明', type: 'textarea' })
  }

  const fields = Array.from(fieldMap.values())

  /* --- 页面 --- */
  const usesTable = featureList.some((ft) =>
    /查询|检索|汇总|明细|列表|全部|查看|导出|台账|统计|看板/.test(`${ft.title}${ft.description}`),
  )
  const baseFeatures = new Set(['filter', 'search', 'export_csv', 'delete_row', 'edit_row'])
  const wantsExport = featureList.some((ft) => /导出|csv|excel|下载/i.test(`${ft.title}${ft.description}`))
  const wantsSearch = featureList.some((ft) => /查询|检索|搜索|筛选|查找/.test(`${ft.title}${ft.description}`))
  const wantsStats = featureList.some((ft) => /统计|汇总|报表|合计|看板|分析/.test(`${ft.title}${ft.description}`))
  const wantsDelete = featureList.some((ft) => /删除|作废|清理/.test(`${ft.title}${ft.description}`))
  const wantsEdit = featureList.some((ft) => /编辑|修改|更正|调整/.test(`${ft.title}${ft.description}`))
  const explicitEffects = featureList.map((ft) => ft.effect).filter(Boolean)

  const tableFeatures = []
  if (wantsSearch || usesTable || explicitEffects.includes('search')) tableFeatures.push('search', 'filter')
  if (wantsExport || usesTable || explicitEffects.includes('export_csv')) tableFeatures.push('export_csv')
  if (wantsDelete || usesTable || explicitEffects.includes('delete_row')) tableFeatures.push('delete_row')
  if (wantsEdit || usesTable || explicitEffects.includes('edit_row')) tableFeatures.push('edit_row')
  if (wantsStats || explicitEffects.includes('chart')) tableFeatures.push('chart')
  if (!tableFeatures.length) tableFeatures.push('search', 'filter', 'export_csv')
  void baseFeatures

  const entityId = previousEntity?.entityId || domain?.entityId || analysis.domainId || 'record'
  const entityName = String(previousEntity?.entityName || domain?.entityName || analysis.entityName || '业务记录')

  const pages = [
    normalizePage({
      pageId: `page_${entityId}_form`,
      pageTitle: `${entityName.replace(/(记录|信息|流水|资料|申请)$/, '')}填报`,
      pageType: 'form',
      targetEntity: entityId,
      description: '按字段规范录入新记录',
    }),
    normalizePage({
      pageId: `page_${entityId}_table`,
      pageTitle: `${entityName}明细与查询`,
      pageType: 'table',
      targetEntity: entityId,
      description: '表格汇总、检索与导出',
      features: Array.from(new Set(tableFeatures)),
    }),
  ]

  const spec = normalizeSpec(
    {
      appId,
      appName: appName || previousSpec?.appName || analysis.appName,
      icon: icon || previousSpec?.icon || analysis.icon,
      version,
      description: description || previousSpec?.description || analysis.description,
      entities: [normalizeEntity({ entityId, entityName, fields })],
      pages,
      // _newFields 是编译期的瞬时上下文，落库前必须剥离，保持功能清单干净
      featureList: featureList.map(({ _newFields, ...ft }) => ({ ...ft, relatedEntityIds: [entityId] })),
      createdAt: previousSpec?.createdAt,
      updatedAt: new Date().toISOString(),
      specVersion: previousSpec?.specVersion,
      changelog: previousSpec?.changelog || [],
    },
    previousSpec || {},
  )

  return spec
}

/* ------------------------ 5. 功能清单的自然语言增删改 ------------------------ */

/**
 * 解析用户对功能清单的增删改指令，返回新的功能清单
 * @param {object} params
 * @param {Array} params.featureList 当前功能清单
 * @param {string} params.text 用户输入
 * @param {string} [params.baseText] 原始需求（新功能需要推断字段时使用）
 */
export function applyFeatureInstruction({ featureList, text, baseText = '' }) {
  const raw = String(text || '').trim()
  const t = normalizeText(raw)
  const analysis = generateFeatureList(baseText || raw)
  const domain = DOMAINS.find((d) => d.id === analysis.domainId) || null
  const notes = []
  let list = [...featureList]

  const isAdd = /(增加|新增|添加|加上|补充|还要|再加|需要|支持|希望能|加入)/.test(t)
  const isRemove = /(去掉|删除|移除|不要|取消|删掉|干掉)/.test(t)
  const isRename = /(改名|重命名|标题改为|改成|改为)/.test(t)

  /* 删除 */
  if (isRemove && !isAdd) {
    const removed = []
    for (const ft of featureList) {
      const title = String(ft.title || '')
      const tokens = [title, title.replace(/[的与和]/g, '')]
      const key2 = title.slice(0, 2)
      // 仅当用户明确说出功能全名（或去掉连接词后的全名）时才命中，
      // 避免「工时明细与汇总」这类整串包含关系误删其它功能（如「工时快速填报」）
      if (tokens.some((tok) => tok.length >= 2 && t.includes(tok)) || (key2.length === 2 && t === key2)) {
        removed.push(ft)
      }
    }
    // 兜底：去掉动词后的剩余短语与标题高度重合
    if (!removed.length) {
      const generic = raw
        .replace(/(去掉|删除|移除|不要|取消|删掉|干掉|这个|那个|的功能|功能|步骤|模块)/g, '')
        .replace(/["'“”\s]/g, '')
        .trim()
      if (generic.length >= 2) {
        for (const ft of featureList) {
          const title = String(ft.title || '').replace(/["'“”\s]/g, '')
          if (title.includes(generic) || generic.includes(title)) removed.push(ft)
        }
      }
    }
    if (removed.length) {
      const ids = new Set(removed.map((r) => r.id))
      list = list.filter((ft) => !ids.has(ft.id))
      const names = removed.map((r) => r.title).join('、')
      notes.push(
        removed.length === 1 ? `已移除功能：${names}` : `已移除 ${removed.length} 项功能：${names}。若只想删其中一项，请说出完整功能名`,
      )
    } else {
      notes.push('未匹配到要移除的功能项，请指明完整的功能名称')
    }
  }

  /* 重命名 / 修改说明 */
  if (isRename) {
    const m = raw.match(/(?:把|将)?\s*(.{2,12}?)(?:功能)?\s*(?:改名|重命名|标题改为|改成|改为)\s*(.{2,20})$/u)
    if (m) {
      const [, target, next] = m
      const hit = list.find((ft) => ft.title.includes(target.trim()) || target.trim().includes(ft.title.slice(0, 2)))
      if (hit) {
        hit.title = next.trim().replace(/[。.]$/, '')
        notes.push(`已将「${target.trim()}」重命名为「${hit.title}」`)
      }
    }
  }

  /* 新增 */
  if (isAdd) {
    const candidates = []
    // 领域可选功能
    if (domain) {
      for (const opt of domain.optionals) {
        if (opt.keywords.some((kw) => t.includes(kw))) candidates.push(opt)
      }
    }
    // 通用可选功能
    for (const opt of GENERIC_OPTIONALS) {
      if (opt.keywords.some((kw) => t.includes(kw))) candidates.push(opt)
    }
    // 跨领域补充：用户在已有应用上提需求时，往往只说了功能名（如「月度优秀员工」），
    // 这时按整库关键词命中来找候选功能，保证「加功能」这件事始终有结果
    if (!candidates.length) {
      const scored = []
      for (const d of DOMAINS) {
        for (const opt of d.optionals || []) {
          const hitsCount = opt.keywords.filter((kw) => t.includes(kw)).length
          if (hitsCount > 0) scored.push({ opt, score: hitsCount })
        }
      }
      scored.sort((a, b) => b.score - a.score)
      if (scored.length) candidates.push(scored[0].opt)
    }
    // 通用「记录/登记」类新功能：从「增加记录月度优秀员工的功能」提取对象
    if (!candidates.length) {
      const m = raw.match(/(?:增加|新增|添加|加上|补充|还要|再加)(?:一个|一项|个)?\s*(?:记录|登记|管理|统计)?\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12})/u)
      if (m) {
        const subject = m[1].replace(/(的)?(功能|模块|页面|信息|记录)$/g, '').trim()
        if (subject) {
          candidates.push({
            icon: '🆕',
            title: `${subject}记录`,
            description: `记录并查看${subject}相关信息`,
            fields: [
              { label: `${subject}名称`, type: 'text', required: true },
              { label: `${subject}日期`, type: 'date' },
              { label: `${subject}说明`, type: 'textarea' },
            ],
          })
        }
      }
    }
    for (const cand of candidates) {
      const exists = list.some((ft) => ft.title.replace(/\s/g, '') === cand.title.replace(/\s/g, ''))
      if (exists) continue
      list.push(
        normalizeFeature(
          {
            id: uid('feat'),
            icon: cand.icon,
            title: cand.title,
            description: cand.description,
            relatedEntityIds: [],
          },
          list.length,
        ),
      )
      // 新功能只带业务信息；字段作为「本轮新增」的瞬时上下文交给编译阶段使用
      const addedFeature = list[list.length - 1]
      if (Array.isArray(cand.fields) && cand.fields.length) addedFeature._newFields = cand.fields
      if (typeof cand.effect === 'string' && cand.effect.startsWith('page-feature:')) {
        addedFeature.effect = cand.effect.slice('page-feature:'.length)
      }
      notes.push(`已新增功能：${cand.title}`)
    }
    if (!notes.length) notes.push('已按您的描述记录新增意图')
  }

  const entityId = featureList[0]?.relatedEntityIds?.[0] || 'record'
  list = list.map((ft) => ({ ...ft, relatedEntityIds: ft.relatedEntityIds?.length ? ft.relatedEntityIds : [entityId] }))

  // 通用能力类功能（导出 / 统计 / 检索等）在表格页上的能力标记
  if (isAdd) {
    const pool = [...DOMAINS.flatMap((d) => d.optionals || []), ...GENERIC_OPTIONALS]
    for (const ft of list) {
      const cand = pool.find((o) => o.title === ft.title)
      if (!ft.effect && cand?.effect?.startsWith('page-feature:')) ft.effect = cand.effect.slice('page-feature:'.length)
    }
  }

  return { featureList: list, notes, changed: notes.some((n) => n.startsWith('已')) }
}

/* --------------------------- 6. 一键起步建议 ---------------------------- */

/** 首页快捷灵感（点击即可作为需求描述） */
export const QUICK_IDEAS = [
  { icon: '📑', label: '员工工时记录', text: '我需要一个记录员工工时和加班的 App，能按部门查询并导出' },
  { icon: '📦', label: '库存出入库管理', text: '做一个简易的物资出入库管理，登记入库出库数量和经办人' },
  { icon: '🤝', label: '客户登记跟进', text: '我需要一个客户登记表，记录联系方式和每次跟进情况' },
  { icon: '🧾', label: '费用报销申请', text: '帮我做一个员工费用报销申请和审批状态跟踪的应用' },
  { icon: '✅', label: '任务待办管理', text: '需要一个任务待办管理，能分派负责人和跟踪进度' },
  { icon: '🏷️', label: '固定资产领用', text: '想要一个固定资产领用和归还登记的工具' },
]

export { DOMAINS, FIELD_TYPE_LABEL }
