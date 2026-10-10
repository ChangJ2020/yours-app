/**
 * Yours App (YA) · 引擎单元测试
 * 运行：npm test   （Node 内置 test runner，零第三方依赖）
 *
 * 覆盖：意图识别、领域识别、功能清单生成、Spec 编译、Diff 与数据无损迁移。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectConfirm, detectIntent, detectModify, INTENT } from '../src/engine/intent.js'
import {
  analyzeRequirement,
  applyFeatureInstruction,
  compileSpecFromFeatureList,
  generateFeatureList,
} from '../src/engine/localEngine.js'
import { respondToDescription } from '../src/engine/agent.js'
import { bumpMinorVersion, normalizeSpec, slugKey } from '../src/engine/spec.js'
import { diffSpec, migrateRecords } from '../src/engine/diff.js'
import { validateRecord } from '../src/engine/validate.js'

/* ------------------------------ 意图识别 ------------------------------ */

test('确认语义能被正确识别（含“功能没问题，继续”这类前置短语）', () => {
  const yes = [
    '可以，继续',
    '功能没问题，继续',
    '没问题',
    '好的',
    'OK',
    '就这样吧',
    '确认',
    '下一步',
    '不用改了',
    '这些都可以',
    '清单没问题',
    '开始生成吧',
  ]
  for (const text of yes) {
    assert.equal(detectConfirm(text), true, `应识别为确认：${text}`)
  }
})

test('修改与否定语义不会被误判为确认', () => {
  const no = [
    '增加一个加班类型字段',
    '去掉审核步骤',
    '不要导出功能',
    '把工时字段改成数字',
    '取消生成',
    '先不生成',
    '增加记录月度优秀员工的功能',
  ]
  for (const text of no) {
    assert.equal(detectConfirm(text), false, `不应识别为确认：${text}`)
  }
})

test('意图分类：确认 / 修改 / 提问 / 描述', () => {
  assert.equal(detectIntent('没问题，继续'), INTENT.CONFIRM)
  assert.equal(detectIntent('增加导出功能'), INTENT.MODIFY)
  assert.equal(detectIntent('这个怎么用'), INTENT.QUESTION)
  assert.equal(detectIntent('我要做一个客户登记表'), INTENT.DESCRIBE)
  assert.equal(detectModify('去掉审核'), true)
})

/* ------------------------------ 领域识别 ------------------------------ */

test('能按关键词识别业务领域', () => {
  const cases = [
    ['我需要一个记录员工工时的 App', 'worklog'],
    ['做一个简易的库存出入库管理', 'inventory'],
    ['客户登记和跟进管理', 'customer'],
    ['员工费用报销申请', 'expense'],
    ['任务待办与进度管理', 'task'],
    ['固定资产领用登记', 'asset'],
  ]
  for (const [text, expected] of cases) {
    const analysis = analyzeRequirement(text)
    assert.equal(analysis.domainId, expected, `「${text}」应识别为 ${expected}`)
  }
})

test('无法识别领域时退化为通用模板而不是报错', () => {
  const draft = generateFeatureList('我要管理花花草草的浇水提醒')
  assert.ok(draft.featureList.length >= 2)
  assert.ok(draft.appName.length > 0)
})

/* ---------------------------- 功能清单生成 ---------------------------- */

test('描述阶段生成的草稿必须保留用户原文（否则后续重编译会丢失业务领域）', () => {
  const raw = '我需要一个记录员工工时和加班的 App'
  const { draft, message } = respondToDescription(raw)
  assert.equal(draft.raw, raw, '草稿必须携带用户原始描述')
  assert.ok(draft.appName)
  assert.ok(message.content.includes('功能'))
})

test('生成的功能清单包含核心功能与关键词触发的扩展功能', () => {
  const draft = generateFeatureList('做一个工时记录 App，需要月度优秀员工评选，还要能导出 Excel')
  const titles = draft.featureList.map((f) => f.title).join('|')
  assert.match(titles, /工时快速填报/)
  assert.match(titles, /优秀员工/)
  assert.match(titles, /导出/)
})

test('功能清单去重且字段完整', () => {
  const draft = generateFeatureList('工时记录 工时记录 工时记录')
  const titles = draft.featureList.map((f) => f.title)
  assert.equal(new Set(titles).size, titles.length)
  for (const f of draft.featureList) {
    assert.ok(f.id && f.title && f.description, '功能项应包含 id/title/description')
  }
})

/* --------------------------- 自然语言增删改 --------------------------- */

test('自然语言新增功能生效', () => {
  const base = generateFeatureList('员工工时记录')
  const { featureList, changed } = applyFeatureInstruction({
    featureList: base.featureList,
    text: '增加记录月度优秀员工的功能',
    baseText: base.analysis.raw,
  })
  assert.equal(changed, true)
  assert.ok(featureList.some((f) => f.title.includes('优秀员工')))
  assert.equal(featureList.length, base.featureList.length + 1)
})

test('自然语言删除功能生效', () => {
  const base = generateFeatureList('员工工时记录，需要审核')
  const target = base.featureList[0]
  const { featureList } = applyFeatureInstruction({
    featureList: base.featureList,
    text: `去掉${target.title}`,
    baseText: base.analysis.raw,
  })
  assert.ok(!featureList.some((f) => f.title === target.title), '目标功能应被移除')
})

test('删除指令只移除被点名的功能，不误伤同前缀的其它功能', () => {
  const base = generateFeatureList('我需要一个记录员工工时和加班的 App，可以按部门查询并导出')
  const target = base.featureList.find((f) => f.title.includes('工时明细与汇总'))
  assert.ok(target, '前置条件：应存在「工时明细与汇总」功能')

  const { featureList, changed } = applyFeatureInstruction({
    featureList: base.featureList,
    text: '去掉工时明细与汇总',
    baseText: base.analysis.raw,
  })

  assert.equal(changed, true)
  assert.equal(featureList.length, base.featureList.length - 1, '每次删除只应减少一项')
  assert.ok(!featureList.some((f) => f.title.includes('工时明细与汇总')))
  assert.ok(
    featureList.some((f) => f.title.includes('工时快速填报')),
    '同样以「工时」开头的其它功能必须保留',
  )
})

test('删除不存在的功能时给出提示且不改变清单', () => {
  const base = generateFeatureList('员工工时记录')
  const { featureList, notes } = applyFeatureInstruction({
    featureList: base.featureList,
    text: '去掉量子对账模块',
    baseText: base.analysis.raw,
  })
  assert.equal(featureList.length, base.featureList.length)
  assert.ok(notes.some((n) => n.includes('未匹配到')), notes.join('；'))
})

test('在已有应用上提需求时，跨领域功能也能被补上', () => {
  // 场景：应用是基于通用模板生成的（baseText 与「优秀员工」无关），
  // 但用户仍要求增加「月度优秀员工」，引擎必须能找到对应功能而不是沉默
  const base = generateFeatureList('客户登记跟进')
  const { featureList, changed } = applyFeatureInstruction({
    featureList: base.featureList,
    text: '增加记录月度优秀员工的功能',
    baseText: '客户登记跟进',
  })
  assert.equal(changed, true)
  const added = featureList.find((f) => f.title.includes('优秀员工'))
  assert.ok(added, '应补上跨领域的「月度优秀员工记录」功能')
  // 功能清单只保留业务信息；字段由 Spec 编译期推导（这样用户删掉的字段才不会被长回来）
  assert.equal(added.fields, undefined, '功能项不应缓存字段定义')

  // 编译时把「用户本轮说的话」作为意图文本，字段才能跟着这次新增的功能走
  const spec = compileSpecFromFeatureList({
    featureList,
    baseText: '客户登记跟进',
    intentText: '增加记录月度优秀员工的功能',
  })
  assert.ok(
    spec.entities[0].fields.some((f) => f.label.includes('评选')),
    `编译后的字段应包含新功能的字段：${spec.entities[0].fields.map((f) => f.label).join('、')}`,
  )
})

test('通用能力类功能会写入表格页能力（导出 / 统计）', () => {
  const base = generateFeatureList('员工工时记录')
  const instruction = '增加数据汇总统计功能'
  const { featureList, changed } = applyFeatureInstruction({
    featureList: base.featureList,
    text: instruction,
    baseText: base.analysis.raw,
  })
  assert.equal(changed, true, '「增加数据汇总统计功能」应被识别为新增功能')
  assert.ok(
    featureList.some((f) => f.effect === 'chart' || f.title.includes('统计')),
    `功能清单应包含统计能力：${featureList.map((f) => `${f.title}${f.effect ? `(${f.effect})` : ''}`).join('、')}`,
  )

  const spec = compileSpecFromFeatureList({ featureList, baseText: base.analysis.raw, intentText: instruction })
  const table = spec.pages.find((p) => p.pageType === 'table')
  assert.ok(table.features.includes('chart'), `表格页应具备统计能力：${table.features.join(',')}`)
})

test('功能清单里已有的领域外功能，其字段也会被补进 Spec', () => {
  // 用户已经把「请假登记」加进功能清单（可能来自上一轮对话），本轮编译必须补齐对应字段
  const base = generateFeatureList('员工工时记录')
  const listWithLeave = [
    ...base.featureList,
    { id: 'feat_leave', icon: '🌴', title: '请假登记', description: '登记请假类型与起止时间', relatedEntityIds: [] },
  ]
  const spec = compileSpecFromFeatureList({ featureList: listWithLeave, baseText: '员工工时记录' })
  const labels = spec.entities[0].fields.map((f) => f.label)
  assert.ok(labels.includes('请假类型') && labels.includes('开始时间'), `应补上请假字段：${labels.join('、')}`)
})

test('点名要某个字段时能补上该字段（即使没提整个功能）', () => {
  const base = generateFeatureList('员工工时记录')
  const spec = compileSpecFromFeatureList({
    featureList: base.featureList,
    baseText: '员工工时记录，增加的字段：加班类型',
  })
  assert.ok(
    spec.entities[0].fields.some((f) => f.label === '加班类型'),
    `应补上被点名的字段：${spec.entities[0].fields.map((f) => f.label).join('、')}`,
  )
})

test('用户删除的字段不会在下次编译时复活', () => {
  const created = compileSpecFromFeatureList({
    featureList: generateFeatureList('员工工时记录').featureList,
    baseText: '员工工时记录',
  })
  const pruned = JSON.parse(JSON.stringify(created))
  const removedLabel = pruned.entities[0].fields[stdIdx(pruned)].label
  pruned.entities[0].fields.splice(stdIdx(pruned), 1)

  // 再次编译（模拟工作室里「同步更新详细 Spec」）
  const again = compileSpecFromFeatureList({
    featureList: pruned.featureList,
    baseText: created.description,
    previousSpec: pruned,
    appName: created.appName,
    description: created.description,
  })
  assert.ok(
    !again.entities[0].fields.some((f) => f.label === removedLabel),
    `被删除的「${removedLabel}」不应复活：${again.entities[0].fields.map((f) => f.label).join('、')}`,
  )
})

function stdIdx(spec) {
  // 固定删除第 3 个字段（工作日期），保证用例稳定
  return Math.min(2, spec.entities[0].fields.length - 1)
}

test('迭代编译不会把整个领域的字段重新灌回已有应用', () => {
  const created = compileSpecFromFeatureList({
    featureList: generateFeatureList('员工工时记录').featureList,
    baseText: '员工工时记录',
  })
  // 用户在工作室里删掉了一个字段
  const trimmed = JSON.parse(JSON.stringify(created))
  const removedLabel = trimmed.entities[0].fields[2].label
  trimmed.entities[0].fields.splice(2, 1)

  // 此时只新增一个领域可选功能（工时审核状态）——字段作为本轮新增的瞬时上下文交给编译阶段
  const nextList = [
    ...trimmed.featureList,
    {
      id: 'feat_new',
      icon: '✅',
      title: '工时审核状态',
      description: '为每条工时补充审核状态',
      relatedEntityIds: [],
      _newFields: [
        { label: '审核状态', type: 'select', options: ['待审核', '已通过', '已驳回'], required: true },
        { label: '审核人', type: 'text' },
      ],
    },
  ]
  const evolved = compileSpecFromFeatureList({
    featureList: nextList,
    baseText: created.description,
    previousSpec: trimmed,
    appName: created.appName,
    description: created.description,
  })

  const before = trimmed.entities[0].fields.map((f) => f.label)
  const after = evolved.entities[0].fields.map((f) => f.label)
  assert.ok(!after.includes(removedLabel), `被删除的「${removedLabel}」不应复活`)
  assert.ok(
    after.every((label) => before.includes(label) || ['审核状态', '审核人'].includes(label)),
    `迭代只应新增该功能带来的字段，实际：${after.join('、')}`,
  )
  assert.equal(after.length, before.length + 2, '应恰好新增 2 个字段（审核状态 / 审核人）')
  assert.equal(
    evolved.featureList.some((f) => f._newFields),
    false,
    '落库的 Spec 里不应残留 _newFields 瞬时字段',
  )
})

test('完整闭环：应用初始构建 → 新增功能 → 用户在编辑器删字段 → 重建必须识别为删除', () => {
  /* 步骤 1：从零构建一个应用（对应首页 4 步生成） */
  const created = compileSpecFromFeatureList({
    featureList: generateFeatureList('我需要一个记录员工工时和加班的 App').featureList,
    baseText: '我需要一个记录员工工时和加班的 App',
  })
  const baseline = created

  /* 步骤 2：在工作室用一句话新增功能（字段随 _newFields 进入 Spec） */
  const plan = applyFeatureInstruction({
    featureList: baseline.featureList,
    text: '增加工时审核状态功能',
    baseText: '员工工时记录助手 记录员工日常出勤、项目工时与工作内容的表单系统。',
  })
  const withAudit = compileSpecFromFeatureList({
    featureList: plan.featureList,
    baseText: baseline.description,
    previousSpec: baseline,
    appName: baseline.appName,
    description: baseline.description,
  })
  const auditLabels = withAudit.entities[0].fields.map((f) => f.label)
  assert.ok(auditLabels.includes('审核状态'), `新增功能应带出审核字段：${auditLabels.join('、')}`)

  /* 步骤 3：用户在详细 Spec 里手工删掉「审核人」 */
  const preview = JSON.parse(JSON.stringify(withAudit))
  preview.entities[0].fields = preview.entities[0].fields.filter((f) => f.label !== '审核人')

  /* 步骤 4：点击重新构建 —— 由于 v1.0.0 里本来就没有「审核人」，
   * 这次删除不会造成历史数据丢失，因此不应误报为「删除字段」（无需归档确认） */
  const diff = diffSpec(baseline, preview)
  assert.equal(
    diff.removedFields.length,
    0,
    `v1.0.0 中不存在的字段被删掉时不应报为删除，实际：${JSON.stringify(diff.changes.map((c) => c.detail))}`,
  )
  assert.equal(diff.dataAffecting, false)
  assert.ok(diff.addedFields.some((f) => f.label === '审核状态'), '新增的字段应被识别为新增')

  /* 步骤 5：第一次重建（v1.0.0 → v1.1.0），审核功能正式生效 */
  const { records: afterFirst, stats: firstStats } = migrateRecords(
    [
      {
        id: 'r1',
        appId: baseline.appId,
        entityId: baseline.entities[0].entityId,
        values: { 员工姓名: '张伟' },
        createdAt: new Date().toISOString(),
      },
    ],
    baseline,
    preview,
  )
  assert.equal(afterFirst.length, 1, '记录数必须保持不变')
  assert.equal(firstStats.archivedValues, 0, '第一次重建只新增字段，没有历史值需要归档')

  /* 步骤 6：v1.1.0 已包含「审核人」，用户此时提交了数据，再把它删掉重建 —— 这次必须归档 */
  const built = withAudit
  const secondPreview = JSON.parse(JSON.stringify(built))

  // 记录里的 key 必须是 Spec 里真实的字段 key（表单提交时写入的就是 key）
  const keyOf = (spec, label) => spec.entities[0].fields.find((f) => f.label === label).key
  const submitted = [
    {
      id: 'r2',
      appId: baseline.appId,
      entityId: built.entities[0].entityId,
      values: {
        [keyOf(built, '员工姓名')]: '李娜',
        [keyOf(built, '审核状态')]: '待审核',
        [keyOf(built, '审核人')]: '王主管',
      },
      createdAt: new Date().toISOString(),
    },
  ]

  // 用户先在编辑器里删掉字段，再看重建差异
  secondPreview.entities[0].fields = secondPreview.entities[0].fields.filter((f) => f.label !== '审核人')
  const secondDiff = diffSpec(built, secondPreview)
  assert.equal(secondDiff.dataAffecting, true, '从已构建版本删除字段必须触发归档保护')
  assert.ok(secondDiff.removedFields.some((f) => f.label === '审核人'))

  const { records: afterSecond, stats: secondStats } = migrateRecords(submitted, built, secondPreview)
  assert.equal(afterSecond.length, 1)
  assert.equal(secondStats.archivedValues, 1, '已存在的历史值必须进入归档区')
  assert.equal(afterSecond[0]._archived[keyOf(built, '审核人')].value, '王主管')
  assert.equal(afterSecond[0].values[keyOf(built, '审核人')], undefined, '主数据中不再保留被删除字段')
  assert.equal(afterSecond[0].values[keyOf(built, '审核状态')], '待审核', '未删除的字段必须完好')
})

test('创建阶段：未被选中的可选功能不会带来多余字段', () => {
  // 描述里没有提到审核、请假、月度优秀员工
  const spec = compileSpecFromFeatureList({
    featureList: generateFeatureList('简单记录一下员工工时').featureList,
    baseText: '简单记录一下员工工时',
  })
  const labels = spec.entities[0].fields.map((f) => f.label)
  assert.ok(!labels.includes('审核状态'), `未要求审核功能，不应出现审核字段：${labels.join('、')}`)
  assert.ok(!labels.includes('请假类型'), `未要求请假功能，不应出现请假字段：${labels.join('、')}`)
  assert.ok(labels.length >= 6, '核心字段仍应完整')
})

test('确认阶段在功能被删空、baseText 缺失等边界下仍能编译出可用 Spec', () => {
  const cases = [
    { featureList: [], baseText: '' },
    { featureList: generateFeatureList('员工工时记录').featureList, baseText: undefined },
    { featureList: [{ id: 'x', title: '脏功能', description: '', fields: [{}, null, { label: 123 }] }], baseText: '' },
  ]
  for (const ctx of cases) {
    const spec = compileSpecFromFeatureList(ctx)
    assert.ok(spec.appName, '必须有应用名')
    assert.ok(spec.entities[0].entityName, '必须有数据表名')
    assert.equal(spec.pages.length, 2, '应同时提供表单页与表格页')
    assert.deepEqual(
      spec.pages.map((p) => p.pageType).sort(),
      ['form', 'table'],
    )
    assert.ok(
      spec.pages.every((p) => p.pageTitle && !String(p.pageTitle).includes('undefined')),
      '页面标题不应出现 undefined',
    )
    assert.ok(
      spec.entities[0].fields.every((f) => f.label && !String(f.label).includes('undefined')),
      '字段名不应出现 undefined',
    )
  }
})

/* ---------------------------- Spec 编译契约 ---------------------------- */

test('功能清单能编译出结构完整的 App Spec', () => {
  const draft = generateFeatureList('记录员工工时和加班，按部门查询并导出')
  const spec = compileSpecFromFeatureList({
    featureList: draft.featureList,
    baseText: draft.analysis.raw,
    appName: draft.appName,
    icon: draft.icon,
    description: draft.description,
  })

  assert.ok(spec.appId)
  assert.equal(spec.version, '1.0.0')
  assert.equal(spec.entities.length, 1)

  const entity = spec.entities[0]
  assert.ok(entity.fields.length >= 5, '应生成 5 个以上字段')

  // 字段必须有合法的 key/type，选项类型必须有 options
  for (const f of entity.fields) {
    assert.match(f.key, /^[A-Za-z_][\w]*$/, `字段 key 非法：${f.key}`)
    assert.ok(f.label)
    if (['select', 'radio', 'checkbox'].includes(f.type)) {
      assert.ok(Array.isArray(f.options) && f.options.length >= 2, `「${f.label}」应至少 2 个选项`)
    }
  }

  // 页面：一个表单 + 一个表格，表格带导出能力
  const form = spec.pages.find((p) => p.pageType === 'form')
  const table = spec.pages.find((p) => p.pageType === 'table')
  assert.ok(form && table, '应同时生成表单页与表格页')
  assert.ok(table.features.includes('export_csv'), '表格页应具备导出能力')
  assert.ok(spec.featureList.length >= 2)
})

test('Spec 规范化能修复脏数据（空实体 / 非法字段类型 / 失联页面）', () => {
  const spec = normalizeSpec({
    appName: '脏数据应用',
    entities: [],
    pages: [{ pageTitle: '野页面', pageType: 'diagram', targetEntity: 'not_exist' }],
    featureList: 'not-an-array',
  })
  assert.equal(spec.entities.length, 1)
  assert.equal(spec.pages.length >= 1, true)
  assert.ok(spec.entities[0].entityId)
  assert.equal(Array.isArray(spec.featureList), true)
  const page = spec.pages.find((p) => p.pageTitle === '野页面')
  assert.equal(page.pageType, 'table', '非法 pageType 应回退为 table')
  for (const f of spec.entities[0].fields) {
    assert.ok(typeof f.type === 'string')
  }
})

test('slugKey 对中文也能产出合法且稳定的 key', () => {
  const a = slugKey('员工姓名')
  const b = slugKey('员工姓名')
  assert.equal(a, b)
  assert.match(a, /^[A-Za-z_][\w]*$/)
  assert.notEqual(slugKey('员工姓名'), slugKey('项目名称'))
})

/* ------------------------------- Diff ------------------------------- */

test('diffSpec 能识别字段与功能的新增/删除/修改', () => {
  const base = compileSpecFromFeatureList({
    featureList: generateFeatureList('员工工时记录').featureList,
    baseText: '员工工时记录',
  })
  const next = JSON.parse(JSON.stringify(base))
  next.entities[0].fields.push({ key: 'overtimeType', label: '加班类型', type: 'select', required: false, options: ['无', '工作日'] })
  next.entities[0].fields = next.entities[0].fields.filter((f) => f.label !== '工作内容描述')
  next.entities[0].fields[0].required = false
  next.featureList.push({ id: 'feat_x', title: '加班统计', description: '统计加班时长' })

  const diff = diffSpec(base, next)
  assert.equal(diff.addedFields.length, 1)
  assert.equal(diff.addedFields[0].label, '加班类型')
  assert.equal(diff.removedFields.length, 1)
  assert.equal(diff.removedFields[0].label, '工作内容描述')
  assert.equal(diff.addedFeatures.length, 1)
  assert.equal(diff.hasChanges, true)
  assert.equal(diff.dataAffecting, true)
})

test('相同 Spec 的 diff 为空', () => {
  const spec = compileSpecFromFeatureList({ featureList: generateFeatureList('客户登记').featureList, baseText: '客户登记' })
  const diff = diffSpec(spec, JSON.parse(JSON.stringify(spec)))
  assert.equal(diff.hasChanges, false)
  assert.equal(diff.changes.length, 0)
})

/* ---------------------------- 数据无损迁移 ---------------------------- */

test('重建迁移：新增字段补默认值、删除字段进入归档、旧数据不丢失', () => {
  const base = compileSpecFromFeatureList({
    featureList: generateFeatureList('员工工时记录').featureList,
    baseText: '员工工时记录',
  })
  const entity = base.entities[0]
  const summaryField = entity.fields.find((f) => f.label === '工作内容描述')
  const nameField = entity.fields.find((f) => f.type === 'text')

  const records = [
    {
      id: 'r1',
      appId: base.appId,
      entityId: entity.entityId,
      values: { [nameField.key]: '张伟', [summaryField.key]: '完成了工时系统联调' },
      createdAt: new Date().toISOString(),
    },
    {
      id: 'r2',
      appId: base.appId,
      entityId: entity.entityId,
      values: { [nameField.key]: '李娜', [summaryField.key]: '输出测试报告' },
      createdAt: new Date().toISOString(),
    },
  ]

  const next = JSON.parse(JSON.stringify(base))
  next.entities[0].fields = next.entities[0].fields.filter((f) => f.key !== summaryField.key)
  next.entities[0].fields.push({ key: 'overtimeType', label: '加班类型', type: 'select', required: false, options: ['无', '工作日加班'] })

  const { records: migrated, stats } = migrateRecords(records, base, next)

  assert.equal(migrated.length, 2, '记录条数必须保持不变')
  assert.equal(stats.archivedValues, 2, '两条历史值应被归档')
  assert.equal(stats.patchedRecords, 2, '两条记录应标记待补充字段')

  for (const r of migrated) {
    assert.equal(r.values[summaryField.key], undefined, '被删除字段不应残留在主数据中')
    assert.equal(r._archived[summaryField.key].value.length > 0, true, '归档区应保留原值')
    assert.equal(r._archived[summaryField.key].label, summaryField.label)
    assert.ok(r.values.overtimeType === '' || r.values.overtimeType === undefined, '新字段应补默认值')
    assert.ok(Array.isArray(r._missing) && r._missing.includes('overtimeType'))
  }

  // 原有字段值不受影响
  const names = migrated.map((r) => r.values[nameField.key]).sort()
  assert.deepEqual(names, ['张伟', '李娜'].sort())
})

test('类型变更：数字字段文本化不丢数据，非法数字转入归档', () => {
  const base = normalizeSpec({
    appName: 't',
    entities: [{ entityId: 'e', entityName: '记录', fields: [{ key: 'amount', label: '金额', type: 'text' }] }],
    pages: [{ pageId: 'p', pageTitle: '明细', pageType: 'table', targetEntity: 'e' }],
  })
  const next = JSON.parse(JSON.stringify(base))
  next.entities[0].fields[0].type = 'number'

  const { records, stats } = migrateRecords(
    [
      { id: 'a', appId: base.appId, entityId: 'e', values: { amount: '128.5' } },
      { id: 'b', appId: base.appId, entityId: 'e', values: { amount: '待确认' } },
    ],
    base,
    next,
  )
  assert.equal(records[0].values.amount, 128.5)
  assert.equal(records[1].values.amount, '')
  assert.equal(records[1]._archived.amount.value, '待确认')
  assert.equal(stats.archivedValues, 1)
})

/* ------------------------------- 版本号 ------------------------------- */

test('版本号按语义化规则升位', () => {
  assert.equal(bumpMinorVersion('1.0.0'), '1.1.0')
  assert.equal(bumpMinorVersion('1.9.3'), '1.10.0')
  assert.equal(bumpMinorVersion('2'), '2.1.0')
})

/* ------------------------------- 校验 ------------------------------- */

test('必填与格式校验规则正确', () => {
  const entity = {
    entityId: 'e',
    entityName: '记录',
    fields: [
      { key: 'name', label: '姓名', type: 'text', required: true },
      { key: 'phone', label: '手机号', type: 'phone' },
      { key: 'hours', label: '工时', type: 'number', min: 0.5, max: 24 },
      { key: 'dept', label: '部门', type: 'select', options: ['研发部', '市场部'] },
      { key: 'date', label: '日期', type: 'date' },
    ],
  }

  const bad = validateRecord(entity, { name: '', phone: '123', hours: 30, dept: '不存在', date: '2026/01/01' })
  assert.equal(bad.valid, false)
  assert.ok(bad.errors.name)
  assert.ok(bad.errors.phone)
  assert.ok(bad.errors.hours)
  assert.ok(bad.errors.dept)
  assert.ok(bad.errors.date)

  const good = validateRecord(entity, {
    name: '张伟',
    phone: '13800138000',
    hours: 8,
    dept: '研发部',
    date: '2026-03-18',
  })
  assert.equal(good.valid, true, JSON.stringify(good.errors))
})
