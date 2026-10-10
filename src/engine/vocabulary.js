/**
 * Yours App (YA) · 本地语义知识库
 * ------------------------------------------------------------------
 * 内置规则引擎的「行业模板 + 业务词表」。
 * 它让系统在没有 LLM 的情况下也能完成一次高质量的应用生成，
 * 同时在接入 LLM 时作为 few-shot 语境与兜底纠偏使用。
 */

/** 字段速写：同 [label, type, extra] */
const f = (label, type = 'text', extra = {}) => ({ label, type, ...extra })

/** 通用附加字段（任何业务都可能需要） */
export const COMMON_FIELDS = [
  f('所属部门', 'select', { options: ['研发部', '市场部', '运营部', '人事行政部', '财务部'], required: false, group: 'base' }),
  f('备注', 'textarea', { group: 'base' }),
]

/** 业务领域模板库 */
export const DOMAINS = [
  {
    id: 'worklog',
    icon: '📑',
    name: '员工工时记录助手',
    entityName: '工时记录',
    keywords: ['工时', '打卡', '考勤', '加班', '排班', '出勤', '日报', '工时填报'],
    strongKeywords: ['工时', '考勤', '加班', '出勤'],
    description: '记录员工日常出勤、项目工时与工作内容的表单系统。',
    fields: [
      f('员工姓名', 'text', { required: true, group: 'base' }),
      f('所属部门', 'select', { options: ['研发部', '市场部', '运营部', '人事行政部'], required: true, group: 'base' }),
      f('工作日期', 'date', { required: true, group: 'base' }),
      f('项目名称', 'text', { required: true, group: 'business' }),
      f('投入工时(小时)', 'number', { required: true, min: 0.5, max: 24, step: 0.5, unit: '小时', group: 'business' }),
      f('加班类型', 'select', { options: ['无', '工作日加班', '休息日加班', '法定节假日加班'], group: 'business' }),
      f('工作内容描述', 'textarea', { group: 'business' }),
    ],
    features: [
      ['🕒', '工时快速填报', '员工自主登记每日出勤、项目与投入工时'],
      ['📊', '工时明细与汇总', '按人员、部门、项目检索历史工时并汇总统计'],
    ],
    optionals: [
      { keywords: ['月度', '优秀员工', '评优', '之星', '表彰'], icon: '🏅', title: '月度优秀员工记录', description: '记录每月优秀员工评选结果与表彰理由', fields: [f('评选月份', 'text', { required: true }), f('优秀员工姓名', 'text', { required: true }), f('评选理由', 'textarea')] },
      { keywords: ['审核', '审批', '批准'], icon: '✅', title: '工时审核状态', description: '为每条工时补充审核状态与审核人信息', fields: [f('审核状态', 'select', { options: ['待审核', '已通过', '已驳回'], required: true }), f('审核人', 'text')] },
      { keywords: ['请假', '休假', '调休'], icon: '🌴', title: '请假登记', description: '登记请假类型、起止时间与审批状态', fields: [f('请假类型', 'select', { options: ['事假', '病假', '年假', '调休'], required: true }), f('开始时间', 'date', { required: true }), f('结束时间', 'date', { required: true })] },
    ],
  },
  {
    id: 'inventory',
    icon: '📦',
    name: '简易库存出入库管理',
    entityName: '出入库流水',
    keywords: ['库存', '出入库', '入库', '出库', '盘点', '物资', '仓库', 'sku', '存货', '进销存'],
    strongKeywords: ['库存', '出入库', '盘点', '仓库'],
    description: '物资出入库登记、库存余量与盘点核对工具。',
    fields: [
      f('物资名称', 'text', { required: true, group: 'base' }),
      f('物资编号', 'text', { group: 'base' }),
      f('规格型号', 'text', { group: 'base' }),
      f('出入库类型', 'radio', { options: ['入库', '出库'], required: true, group: 'business' }),
      f('数量', 'number', { required: true, min: 1, unit: '件', group: 'business' }),
      f('单价(元)', 'currency', { group: 'business' }),
      f('经办人', 'text', { required: true, group: 'business' }),
      f('业务日期', 'date', { required: true, group: 'business' }),
      f('存放位置', 'text', { group: 'business' }),
    ],
    features: [
      ['📥', '出入库登记', '扫码式快速录入入库与出库流水'],
      ['📦', '库存明细与检索', '按物资、类型、时间筛选流水并导出'],
    ],
    optionals: [
      { keywords: ['盘点', '对账', '盘亏', '盘盈'], icon: '🧮', title: '库存盘点记录', description: '记录盘点结果与差异原因', fields: [f('盘点日期', 'date', { required: true }), f('账面数量', 'number'), f('实盘数量', 'number'), f('差异原因', 'textarea')] },
      { keywords: ['供应商', '供货商', '采购'], icon: '🚚', title: '供应商信息', description: '维护供应商联系人与合作信息', fields: [f('供应商名称', 'text', { required: true }), f('联系人', 'text'), f('联系电话', 'phone')] },
      { keywords: ['预警', '库存不足', '下限'], icon: '⚠️', title: '低库存预警线', description: '为物资设置安全库存阈值', fields: [f('安全库存下限', 'number', { required: true })] },
    ],
  },
  {
    id: 'customer',
    icon: '🤝',
    name: '客户登记与跟进台账',
    entityName: '客户信息',
    keywords: ['客户', '线索', 'crm', '销售', '商机', '跟进', '联系人', '拜访'],
    strongKeywords: ['客户', '线索', '商机', '跟进'],
    description: '登记客户档案、跟进记录与成交状态的轻量 CRM。',
    fields: [
      f('客户名称', 'text', { required: true, group: 'base' }),
      f('客户类型', 'select', { options: ['潜在客户', '意向客户', '成交客户', '流失客户'], required: true, group: 'base' }),
      f('联系人', 'text', { required: true, group: 'base' }),
      f('联系电话', 'phone', { required: true, group: 'base' }),
      f('客户邮箱', 'email', { group: 'base' }),
      f('所属行业', 'select', { options: ['互联网', '制造业', '金融', '教育', '医疗健康', '其他'], group: 'business' }),
      f('跟进方式', 'radio', { options: ['电话', '微信', '上门拜访', '邮件'], group: 'business' }),
      f('下次跟进日期', 'date', { group: 'business' }),
      f('跟进记录', 'textarea', { group: 'business' }),
    ],
    features: [
      ['🧑‍💼', '客户档案登记', '录入客户基础信息与联系方式'],
      ['🔍', '客户检索与跟进视图', '按类型、行业筛选客户并查看跟进记录'],
    ],
    optionals: [
      { keywords: ['成交', '合同', '签约', '金额'], icon: '💰', title: '成交金额记录', description: '记录合同金额与签约时间', fields: [f('成交金额(元)', 'currency', { required: true }), f('签约日期', 'date')] },
      { keywords: ['回访', '提醒', '待办'], icon: '⏰', title: '回访提醒', description: '设置回访提醒时间与提醒人', fields: [f('提醒时间', 'datetime', { required: true }), f('提醒人', 'text')] },
      { keywords: ['满意度', '评分', '评价'], icon: '⭐', title: '客户满意度评分', description: '记录客户满意度星级与评价', fields: [f('满意度评分', 'rating', { required: true }), f('评价内容', 'textarea')] },
    ],
  },
  {
    id: 'expense',
    icon: '🧾',
    name: '费用报销申请管理',
    entityName: '报销申请',
    keywords: ['报销', '费用', '发票', '差旅', '申请单', '借款', '采购申请'],
    strongKeywords: ['报销', '费用', '发票', '差旅'],
    description: '员工费用报销申请、审批状态与票据归档管理。',
    fields: [
      f('申请人', 'text', { required: true, group: 'base' }),
      f('所属部门', 'select', { options: ['研发部', '市场部', '运营部', '财务部'], required: true, group: 'base' }),
      f('费用类型', 'select', { options: ['差旅费', '交通费', '餐饮费', '办公用品', '业务招待费', '其他'], required: true, group: 'business' }),
      f('报销金额(元)', 'currency', { required: true, min: 0, group: 'business' }),
      f('发生日期', 'date', { required: true, group: 'business' }),
      f('费用说明', 'textarea', { required: true, group: 'business' }),
      f('审批状态', 'select', { options: ['待审批', '审批中', '已通过', '已驳回', '已打款'], required: true, group: 'business' }),
    ],
    features: [
      ['📝', '报销单提交', '填写费用明细并提交报销申请'],
      ['📋', '报销台账与筛选', '按状态、费用类型查询报销进度'],
    ],
    optionals: [
      { keywords: ['发票', '票据', '凭证'], icon: '🧾', title: '发票信息登记', description: '登记发票号与开票方信息', fields: [f('发票号码', 'text', { required: true }), f('开票方', 'text')] },
      { keywords: ['审批', '审核', '领导'], icon: '✅', title: '审批人流转', description: '记录各级审批人与审批意见', fields: [f('审批人', 'text', { required: true }), f('审批意见', 'textarea')] },
      { keywords: ['预算', '额度', '控制'], icon: '📉', title: '部门预算占用', description: '记录本次报销占用的部门预算额度', fields: [f('占用预算(元)', 'currency')] },
    ],
  },
  {
    id: 'task',
    icon: '✅',
    name: '任务与项目待办管理',
    entityName: '任务',
    keywords: ['任务', '待办', 'todo', '项目', '工单', '需求池', '排期', '进度'],
    strongKeywords: ['任务', '待办', '工单', '排期'],
    description: '任务分派、进度跟踪与完成情况统计。',
    fields: [
      f('任务标题', 'text', { required: true, group: 'base' }),
      f('负责人', 'text', { required: true, group: 'base' }),
      f('优先级', 'radio', { options: ['P0-紧急', 'P1-高', 'P2-中', 'P3-低'], required: true, group: 'base' }),
      f('任务状态', 'select', { options: ['待开始', '进行中', '待验收', '已完成', '已取消'], required: true, group: 'business' }),
      f('所属项目', 'text', { group: 'business' }),
      f('截止日期', 'date', { group: 'business' }),
      f('预计工时', 'number', { min: 0, step: 0.5, unit: '小时', group: 'business' }),
      f('任务描述', 'textarea', { group: 'business' }),
    ],
    features: [
      ['📌', '任务快速创建', '录入任务标题、负责人、优先级与截止时间'],
      ['📈', '任务看板与进度查询', '按状态与负责人筛选，跟踪完成进度'],
    ],
    optionals: [
      { keywords: ['工时', '耗时', '实际'], icon: '⏱️', title: '实际耗时记录', description: '记录任务实际投入工时', fields: [f('实际工时', 'number', { min: 0, step: 0.5, unit: '小时' })] },
      { keywords: ['评论', '协作', '沟通'], icon: '💬', title: '任务协作评论', description: '记录任务进展沟通内容', fields: [f('最新进展', 'textarea')] },
      { keywords: ['风险', '阻塞', '问题'], icon: '🚧', title: '风险与阻塞标记', description: '标记任务风险等级与阻塞原因', fields: [f('风险等级', 'select', { options: ['无', '低', '中', '高'] }), f('阻塞原因', 'textarea')] },
    ],
  },
  {
    id: 'asset',
    icon: '🏷️',
    name: '固定资产领用管理',
    entityName: '资产记录',
    keywords: ['资产', '设备', '领用', '固定资产', '笔记本电脑', '归还', 'it资产'],
    strongKeywords: ['资产', '领用', '固定资产'],
    description: '固定资产台账、领用归还与折旧信息管理。',
    fields: [
      f('资产名称', 'text', { required: true, group: 'base' }),
      f('资产编号', 'text', { required: true, group: 'base' }),
      f('资产类别', 'select', { options: ['电脑设备', '办公家具', '网络设备', '车辆', '其他'], required: true, group: 'base' }),
      f('领用人', 'text', { group: 'business' }),
      f('领用日期', 'date', { group: 'business' }),
      f('资产状态', 'radio', { options: ['在库', '已领用', '维修中', '已报废'], required: true, group: 'business' }),
      f('购置金额(元)', 'currency', { group: 'business' }),
      f('存放地点', 'text', { group: 'business' }),
    ],
    features: [
      ['🏷️', '资产台账登记', '录入资产基础信息与购置信息'],
      ['🔄', '领用与归还记录', '跟踪资产去向与责任人'],
    ],
    optionals: [
      { keywords: ['折旧', '净值', '年限'], icon: '📉', title: '折旧计算', description: '按使用年限估算资产净值', fields: [f('使用年限(年)', 'number', { min: 1 }), f('资产净值(元)', 'currency')] },
      { keywords: ['维修', '故障', '报修'], icon: '🔧', title: '维修记录', description: '登记维修时间、费用与结果', fields: [f('维修日期', 'date'), f('维修费用(元)', 'currency'), f('维修结果', 'textarea')] },
      { keywords: ['盘点', '清查'], icon: '🧮', title: '资产盘点', description: '记录盘点结果与差异', fields: [f('盘点结果', 'select', { options: ['正常', '盘亏', '盘盈', '待核实'] })] },
    ],
  },
  {
    id: 'doc',
    icon: '🗂️',
    name: '文档资料归档管理',
    entityName: '文档资料',
    keywords: ['文档', '资料', '档案', '知识库', '合同', '文件', '规章'],
    strongKeywords: ['文档', '资料', '档案', '知识库'],
    description: '文档资料登记、分类归档与借阅管理。',
    fields: [
      f('文档名称', 'text', { required: true, group: 'base' }),
      f('文档编号', 'text', { group: 'base' }),
      f('文档分类', 'select', { options: ['制度规范', '合同协议', '技术资料', '会议纪要', '其他'], required: true, group: 'base' }),
      f('归属部门', 'select', { options: ['研发部', '市场部', '运营部', '人事行政部', '财务部'], group: 'business' }),
      f('版本号', 'text', { group: 'business' }),
      f('归档日期', 'date', { group: 'business' }),
      f('是否对外公开', 'switch', { group: 'business' }),
      f('内容摘要', 'textarea', { group: 'business' }),
    ],
    features: [
      ['📤', '文档登记与归档', '录入文档元数据并归类存放'],
      ['🔎', '文档检索', '按分类、部门与关键字查询文档'],
    ],
    optionals: [
      { keywords: ['借阅', '借出', '归还'], icon: '📚', title: '借阅登记', description: '记录借阅人、借出与归还时间', fields: [f('借阅人', 'text'), f('借出日期', 'date'), f('归还日期', 'date')] },
      { keywords: ['保密', '密级', '权限'], icon: '🔒', title: '密级标识', description: '标记文档密级与可见范围', fields: [f('密级', 'select', { options: ['公开', '内部', '秘密', '机密'] })] },
      { keywords: ['过期', '有效期', '到期'], icon: '⏳', title: '有效期提醒', description: '记录文档有效期与到期提醒', fields: [f('有效期至', 'date')] },
    ],
  },
  {
    id: 'member',
    icon: '👥',
    name: '员工花名册与信息登记',
    entityName: '员工信息',
    keywords: ['员工', '花名册', '人员', '入职', '人事', '通讯录', '工号'],
    strongKeywords: ['员工', '花名册', '入职', '人事'],
    description: '员工基础信息、岗位与在职状态登记管理。',
    fields: [
      f('员工姓名', 'text', { required: true, group: 'base' }),
      f('员工工号', 'text', { required: true, group: 'base' }),
      f('所属部门', 'select', { options: ['研发部', '市场部', '运营部', '人事行政部', '财务部'], required: true, group: 'base' }),
      f('岗位名称', 'text', { required: true, group: 'business' }),
      f('入职日期', 'date', { required: true, group: 'business' }),
      f('联系电话', 'phone', { group: 'base' }),
      f('在职状态', 'select', { options: ['在职', '试用期', '离职', '停薪留职'], required: true, group: 'business' }),
      f('学历', 'select', { options: ['大专', '本科', '硕士', '博士', '其他'], group: 'business' }),
    ],
    features: [
      ['👤', '员工信息登记', '录入员工基础档案与岗位信息'],
      ['📇', '花名册检索', '按部门、在职状态筛选人员'],
    ],
    optionals: [
      { keywords: ['转正', '试用'], icon: '📆', title: '转正日期记录', description: '记录试用期与转正时间', fields: [f('转正日期', 'date')] },
      { keywords: ['薪资', '工资', '薪酬'], icon: '💰', title: '薪酬信息', description: '记录基本薪资与发放周期', fields: [f('基本薪资(元)', 'currency'), f('发放周期', 'select', { options: ['月薪', '年薪', '时薪'] })] },
      { keywords: ['紧急', '家属', '联系人'], icon: '🆘', title: '紧急联系人', description: '登记紧急联系人与关系', fields: [f('紧急联系人', 'text'), f('紧急联系电话', 'phone')] },
    ],
  },
  {
    id: 'meeting',
    icon: '📅',
    name: '会议与会议室预定管理',
    entityName: '会议记录',
    keywords: ['会议', '会议室', '预定', '纪要', '例会', '议程'],
    strongKeywords: ['会议', '会议室', '纪要'],
    description: '会议安排、会议室占用与会议纪要归档。',
    fields: [
      f('会议主题', 'text', { required: true, group: 'base' }),
      f('会议室', 'select', { options: ['第一会议室', '第二会议室', '洽谈室A', '线上会议'], required: true, group: 'base' }),
      f('开始时间', 'datetime', { required: true, group: 'business' }),
      f('结束时间', 'datetime', { required: true, group: 'business' }),
      f('主持人', 'text', { required: true, group: 'business' }),
      f('参会人员', 'textarea', { group: 'business' }),
      f('会议纪要', 'textarea', { group: 'business' }),
    ],
    features: [
      ['📅', '会议预定', '登记会议主题、时间与会议室占用'],
      ['📝', '会议纪要与查询', '归档会议纪要并支持按主题检索'],
    ],
    optionals: [
      { keywords: ['待办', '行动项', '跟进'], icon: '✅', title: '会后行动项', description: '记录会后待办与责任人', fields: [f('行动项', 'textarea'), f('责任人', 'text')] },
      { keywords: ['提醒', '通知'], icon: '🔔', title: '会议提醒', description: '设置会前提醒时间', fields: [f('提醒时间', 'datetime')] },
    ],
  },
  {
    id: 'quality',
    icon: '🔍',
    name: '质量检验与巡检记录',
    entityName: '检验记录',
    keywords: ['质检', '检验', '巡检', '质量', '抽检', '不合格', '整改'],
    strongKeywords: ['质检', '巡检', '检验', '质量'],
    description: '检验批次结果、不合格项与整改闭环管理。',
    fields: [
      f('检验批次号', 'text', { required: true, group: 'base' }),
      f('产品名称', 'text', { required: true, group: 'base' }),
      f('检验类型', 'radio', { options: ['来料检验', '过程检验', '成品检验', '巡检'], required: true, group: 'base' }),
      f('检验日期', 'date', { required: true, group: 'business' }),
      f('抽检数量', 'number', { min: 0, group: 'business' }),
      f('不合格数量', 'number', { min: 0, group: 'business' }),
      f('检验结论', 'select', { options: ['合格', '让步接收', '返工', '判退'], required: true, group: 'business' }),
      f('异常描述', 'textarea', { group: 'business' }),
    ],
    features: [
      ['🔬', '检验结果录入', '登记批次抽检数量与检验结论'],
      ['📉', '质量数据查询与导出', '按批次、结论筛选并统计不合格率'],
    ],
    optionals: [
      { keywords: ['整改', '纠偏', '措施'], icon: '🛠️', title: '整改跟踪', description: '记录整改措施与完成情况', fields: [f('整改措施', 'textarea'), f('整改完成日期', 'date')] },
      { keywords: ['检验员', '责任人'], icon: '🧑‍🔬', title: '检验员记录', description: '登记检验执行人', fields: [f('检验员', 'text', { required: true })] },
    ],
  },
]

/** 通用可选功能（所有领域都可能被要求） */
export const GENERIC_OPTIONALS = [
  {
    keywords: ['导出', 'excel', 'csv', '下载'],
    icon: '📤',
    title: '数据导出为 CSV/Excel',
    description: '支持将筛选后的数据一键导出为表格文件',
    effect: 'page-feature:export_csv',
  },
  {
    keywords: ['搜索', '查询', '检索', '筛选'],
    icon: '🔎',
    title: '关键词搜索与筛选',
    description: '在列表页按关键词与字段条件快速定位记录',
    effect: 'page-feature:search',
  },
  {
    keywords: ['统计', '汇总', '报表', '合计', '看板'],
    icon: '📊',
    title: '数据汇总统计',
    description: '对数值字段自动求和、求平均并展示统计卡片',
    effect: 'page-feature:chart',
  },
  {
    keywords: ['删除', '清理', '作废'],
    icon: '🗑️',
    title: '记录删除与作废',
    description: '支持对错误记录执行删除操作',
    effect: 'page-feature:delete_row',
  },
  {
    keywords: ['编辑', '修改', '更正'],
    icon: '✏️',
    title: '记录修改',
    description: '支持对已提交记录进行二次编辑',
    effect: 'page-feature:edit_row',
  },
]

/** 场景关键词 → 领域 id（用于识别“我需要一个 xxx 的 App”这类句式） */
export const SCENE_HINTS = [
  { keywords: ['轻量', '简单', '简易', '小'], bias: 1 },
]

/** 常见字段关键词 → 字段定义（从自然语言中补捞字段） */
export const FIELD_KEYWORD_MAP = [
  { keywords: ['姓名', '员工姓名', '申请人', '负责人', '联系人'], field: f('姓名', 'text', { required: true }) },
  { keywords: ['部门', '所属部门'], field: f('所属部门', 'select', { options: ['研发部', '市场部', '运营部', '人事行政部', '财务部'] }) },
  { keywords: ['日期', '时间', '每天', '当日'], field: f('业务日期', 'date') },
  { keywords: ['数量', '个数', '件数'], field: f('数量', 'number', { min: 0 }) },
  { keywords: ['金额', '费用', '价格', '单价', '花费'], field: f('金额(元)', 'currency', { min: 0 }) },
  { keywords: ['电话', '手机', '联系方式'], field: f('联系电话', 'phone') },
  { keywords: ['邮箱', 'email', '邮件'], field: f('电子邮箱', 'email') },
  { keywords: ['备注', '说明', '描述', '内容'], field: f('备注说明', 'textarea') },
  { keywords: ['状态', '进度', '阶段'], field: f('当前状态', 'select', { options: ['待处理', '处理中', '已完成'] }) },
  { keywords: ['评分', '星级', '满意度'], field: f('评分', 'rating') },
  { keywords: ['是否', '有无', '确认'], field: f('是否确认', 'switch') },
]

/** 停用词（避免把“我需要一个”当成实体名） */
export const STOP_WORDS = [
  '我', '想', '要', '需要', '一个', '个', '的', '请', '帮我', '做个', '做', '开发', '生成', '创建', '建',
  '系统', 'app', '应用', '程序', '工具', '平台', '小程序', '软件', '用来', '用于', '可以', '能', '实现',
  '管理', '记录', '登记', '功能', '模块', '页面', '表单', '麻烦', '谢谢', '你好', '简单', '轻量', '一下',
]
