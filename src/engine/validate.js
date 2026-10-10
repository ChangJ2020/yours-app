/**
 * Yours App (YA) · 字段校验引擎
 * 与渲染层解耦：同一份规则供表单提交、批量导入、AI 数据自检复用。
 */

import { OPTION_TYPES } from './spec.js'

const isEmpty = (v) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

const EMAIL_RE = /^[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
const PHONE_RE = /^1[3-9]\d{9}$/

/**
 * 校验单条记录
 * @param {object} entity 实体定义（含 fields）
 * @param {object} values 表单值
 * @returns {{valid:boolean, errors:Record<string,string>, firstError:string}}
 */
export function validateRecord(entity, values = {}) {
  const errors = {}
  for (const field of entity?.fields || []) {
    const value = values[field.key]
    const label = field.label

    if (field.required && isEmpty(value)) {
      errors[field.key] = `请填写「${label}」`
      continue
    }
    if (isEmpty(value)) continue

    switch (field.type) {
      case 'number':
      case 'currency': {
        const num = Number(value)
        if (!Number.isFinite(num)) {
          errors[field.key] = `「${label}」必须是数字`
          break
        }
        if (field.min !== undefined && num < field.min) {
          errors[field.key] = `「${label}」不能小于 ${field.min}${field.unit || ''}`
        } else if (field.max !== undefined && num > field.max) {
          errors[field.key] = `「${label}」不能大于 ${field.max}${field.unit || ''}`
        }
        break
      }
      case 'rating': {
        const num = Number(value)
        const min = field.min ?? 1
        const max = field.max ?? 5
        if (!Number.isFinite(num) || num < min || num > max) {
          errors[field.key] = `「${label}」应为 ${min}~${max} 之间的整数`
        }
        break
      }
      case 'email':
        if (!EMAIL_RE.test(String(value).trim())) errors[field.key] = `「${label}」邮箱格式不正确`
        break
      case 'phone':
        if (!PHONE_RE.test(String(value).trim())) errors[field.key] = `「${label}」手机号格式不正确（11 位）`
        break
      case 'select':
      case 'radio':
        if (field.options?.length && !field.options.includes(value)) {
          errors[field.key] = `「${label}」请选择有效选项`
        }
        break
      case 'checkbox':
        if (field.options?.length) {
          const arr = Array.isArray(value) ? value : [value]
          const invalid = arr.filter((v) => !field.options.includes(v))
          if (invalid.length) errors[field.key] = `「${label}」包含无效选项：${invalid.join('、')}`
        }
        break
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
          errors[field.key] = `「${label}」请选择日期`
        }
        break
      case 'datetime':
        if (Number.isNaN(new Date(value).getTime())) errors[field.key] = `「${label}」时间格式不正确`
        break
      case 'text':
      case 'textarea':
        if (field.type === 'text' && String(value).length > 200) {
          errors[field.key] = `「${label}」长度不能超过 200 字`
        }
        break
      default:
        break
    }
  }

  const keys = Object.keys(errors)
  return {
    valid: keys.length === 0,
    errors,
    firstError: keys.length ? errors[keys[0]] : '',
  }
}

/** 表单填写进度（用于提交按钮提示） */
export function completionRate(entity, values = {}) {
  const fields = entity?.fields || []
  if (!fields.length) return 1
  const required = fields.filter((f) => f.required)
  const pool = required.length ? required : fields
  const done = pool.filter((f) => !isEmpty(values[f.key])).length
  return done / pool.length
}

export { OPTION_TYPES }
