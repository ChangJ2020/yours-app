/**
 * Yours App (YA) · 首次打开时的演示数据
 * ------------------------------------------------------------------
 * 交付「开箱即可体验」：预置一个员工工时记录应用 + 若干条真实感数据，
 * 用户可以直接看到动态表格、检索、导出、以及「用 AI 迭代此 App」的完整链路。
 * 用户可以随时在首页右上角「清空重置」移除全部本地数据。
 */

import { normalizeSpec, uid } from '@/engine/spec.js'

const SEED_FLAG = 'ya:seeded'

export const DEMO_SPEC = normalizeSpec({
  appId: 'app_worklog_demo',
  appName: '员工工时记录助手',
  icon: '📑',
  version: '1.0.0',
  description: '记录各部门员工日常出勤、项目工时与工作内容的表单系统。',
  createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
  entities: [
    {
      entityId: 'worklog',
      entityName: '工时记录',
      fields: [
        { key: 'employeeName', label: '员工姓名', type: 'text', required: true },
        {
          key: 'department',
          label: '所属部门',
          type: 'select',
          options: ['研发部', '市场部', '运营部', '人事行政部'],
          required: true,
        },
        { key: 'workDate', label: '工作日期', type: 'date', required: true },
        { key: 'projectName', label: '项目名称', type: 'text', required: true },
        { key: 'hours', label: '投入工时', type: 'number', required: true, min: 0.5, max: 24, step: 0.5, unit: '小时' },
        { key: 'workSummary', label: '工作内容描述', type: 'textarea' },
      ],
    },
  ],
  pages: [
    { pageId: 'page_worklog_form', pageTitle: '工时填报', pageType: 'form', targetEntity: 'worklog' },
    {
      pageId: 'page_worklog_table',
      pageTitle: '工时明细与汇总',
      pageType: 'table',
      targetEntity: 'worklog',
      features: ['filter', 'search', 'export_csv', 'delete_row', 'edit_row'],
    },
  ],
  featureList: [
    { id: 'feat_1', icon: '🕒', title: '工时快速填报', description: '员工自主登记每日出勤、项目与投入工时', relatedEntityIds: ['worklog'] },
    { id: 'feat_2', icon: '📊', title: '工时明细与汇总', description: '按人员、部门、项目检索历史工时并汇总统计', relatedEntityIds: ['worklog'] },
    { id: 'feat_3', icon: '📤', title: '数据导出为 CSV/Excel', description: '支持将筛选后的数据一键导出为表格文件', relatedEntityIds: ['worklog'] },
  ],
})

const NAMES = ['张伟', '李娜', '王强', '刘洋', '陈静', '赵磊', '孙悦', '周涛', '吴敏', '郑凯']
const DEPTS = ['研发部', '市场部', '运营部', '人事行政部']
const PROJECTS = ['YA 平台前端重构', '客户管理系统升级', '季度市场推广', '内部流程数字化', '移动端适配专项']
const SUMMARIES = [
  '完成原型评审并同步开发排期',
  '修复列表页筛选异常问题',
  '对接第三方数据接口并联调',
  '输出需求说明书初稿',
  '组织跨部门对齐会议',
  '整理测试用例并执行回归',
  '优化首页加载性能，首屏降低 30%',
  '撰写产品周报与数据看板',
]

const pick = (arr, i) => arr[i % arr.length]

/** 生成 14 条演示记录（跨最近两周） */
export function buildDemoRecords() {
  const rows = []
  const today = new Date()
  for (let i = 0; i < 14; i += 1) {
    const day = new Date(today.getTime() - (i % 12) * 86400000)
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    rows.push({
      id: uid('rec'),
      appId: DEMO_SPEC.appId,
      entityId: 'worklog',
      values: {
        employeeName: pick(NAMES, i * 3 + 1),
        department: pick(DEPTS, i + Math.floor(i / 3)),
        workDate: iso,
        projectName: pick(PROJECTS, i + Math.floor(i / 2)),
        hours: [8, 7.5, 6, 8, 4.5, 9][i % 6],
        workSummary: pick(SUMMARIES, i * 2 + 1),
      },
      createdAt: new Date(day.getTime() + 9 * 3600000).toISOString(),
      updatedAt: new Date(day.getTime() + 9 * 3600000).toISOString(),
    })
  }
  return rows
}

/** 是否已完成首次播种 */
export function isSeeded() {
  try {
    return localStorage.getItem(SEED_FLAG) === '1'
  } catch {
    return true
  }
}

export function markSeeded() {
  try {
    localStorage.setItem(SEED_FLAG, '1')
  } catch {
    /* ignore */
  }
}

export function clearSeedFlag() {
  try {
    localStorage.removeItem(SEED_FLAG)
  } catch {
    /* ignore */
  }
}
