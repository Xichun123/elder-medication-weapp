export const dictionaries = {
  drug_category: [
    { value: 'antibiotic', label: '抗生素' },
    { value: 'antihypertensive', label: '降压药' },
    { value: 'hypoglycemic', label: '降糖药' },
    { value: 'antiplatelet', label: '抗血小板' },
    { value: 'other', label: '其他' },
  ],
  reminder_status: [
    { value: 'pending', label: '待服' },
    { value: 'taken', label: '已服' },
    { value: 'skipped', label: '跳过' },
    { value: 'abnormal', label: '异常' },
  ],
  contraindication_type: [
    { value: 'co_administration', label: '同服禁忌' },
    { value: 'diet', label: '饮食禁忌' },
    { value: 'disease', label: '疾病禁忌' },
  ],
  gender: [
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
  ],
  voice_tone: [
    { value: 'female_warm', label: '女声温和' },
    { value: 'male', label: '男声' },
    { value: 'dialect_dongbei', label: '东北话' },
    { value: 'dialect_sichuan', label: '四川话' },
    { value: 'dialect_cantonese', label: '粤语' },
    { value: 'dialect_henan', label: '河南话' },
  ],
  severity: [
    { value: 'light', label: '轻' },
    { value: 'middle', label: '中' },
    { value: 'severe', label: '严重' },
  ],
  home_role: [
    { value: 'owner', label: '家庭创建人' },
    { value: 'caregiver_edit', label: '可录入家属' },
    { value: 'caregiver_view', label: '只读家属' },
    { value: 'elder', label: '老人本人' },
  ],
}

export function label(name, value) {
  return ((dictionaries[name] || []).find((item) => item.value === value) || {}).label || value || ''
}
