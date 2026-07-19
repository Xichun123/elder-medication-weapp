const dictionaries = {
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
  family_role: [
    { value: 'child', label: '子女' },
    { value: 'spouse', label: '配偶' },
    { value: 'caregiver', label: '护工' },
  ],
  permission_level: [
    { value: 'editable', label: '可录入' },
    { value: 'readonly', label: '仅查看' },
  ],
  gender: [
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
  ],
  voice_tone: [
    { value: 'female_warm', label: '女声温和' },
    { value: 'male', label: '男声' },
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

function createSeedData() {
  return {
    version: 1,
    elders: [
      { elder_id: 'E01', name: '李秀兰', gender: 'female', age: 72, relationship: '母亲', allergy_note: '青霉素过敏', voice_tone: 'female_warm' },
      { elder_id: 'E02', name: '王建国', gender: 'male', age: 68, relationship: '父亲', allergy_note: '无', voice_tone: 'male' },
      { elder_id: 'E03', name: '张桂芳', gender: 'female', age: 75, relationship: '祖母', allergy_note: '磺胺类过敏', voice_tone: 'female_warm' },
      { elder_id: 'E04', name: '陈志远', gender: 'male', age: 70, relationship: '外祖父', allergy_note: '无', voice_tone: 'male' },
      { elder_id: 'E05', name: '刘淑珍', gender: 'female', age: 66, relationship: '岳母', allergy_note: '头孢类过敏', voice_tone: 'female_warm' },
    ],
    families: [
      { family_id: 'F01', name: '李明', phone: '13800000001', role: 'child' },
      { family_id: 'F02', name: '王晓', phone: '13900000002', role: 'child' },
      { family_id: 'F03', name: '张伟', phone: '13700000003', role: 'child' },
      { family_id: 'F04', name: '陈静', phone: '13600000004', role: 'spouse' },
      { family_id: 'F05', name: '刘强', phone: '13500000005', role: 'child' },
    ],
    relations: [
      { relation_id: 'FE01', family: 'F01', elder: 'E01', relation_type: 'child', permission_level: 'editable' },
      { relation_id: 'FE02', family: 'F01', elder: 'E02', relation_type: 'child', permission_level: 'editable' },
      { relation_id: 'FE03', family: 'F02', elder: 'E02', relation_type: 'child', permission_level: 'editable' },
      { relation_id: 'FE04', family: 'F03', elder: 'E03', relation_type: 'child', permission_level: 'editable' },
      { relation_id: 'FE05', family: 'F04', elder: 'E04', relation_type: 'spouse', permission_level: 'editable' },
    ],
    drugs: [
      { drug_id: 'D01', generic_name: '阿莫西林', trade_name: '阿莫仙', aliases: '羟氨苄青霉素', category: 'antibiotic', ingredient: '阿莫西林', dosage_text: '0.5g', contraindication_note: '青霉素过敏者禁用', interaction_note: '避免与活菌制剂同服' },
      { drug_id: 'D02', generic_name: '硝苯地平', trade_name: '心痛定', aliases: '硝苯吡啶', category: 'antihypertensive', ingredient: '硝苯地平', dosage_text: '10mg', contraindication_note: '严重主动脉瓣狭窄禁用', interaction_note: '避免与西柚同服' },
      { drug_id: 'D03', generic_name: '二甲双胍', trade_name: '格华止', aliases: '', category: 'hypoglycemic', ingredient: '二甲双胍', dosage_text: '0.5g', contraindication_note: '严重肾功能不全禁用', interaction_note: '避免饮酒' },
      { drug_id: 'D04', generic_name: '阿司匹林', trade_name: '拜阿司匹灵', aliases: '乙酰水杨酸', category: 'antiplatelet', ingredient: '阿司匹林', dosage_text: '100mg', contraindication_note: '活动性消化道溃疡禁用', interaction_note: '避免与布洛芬同服' },
      { drug_id: 'D05', generic_name: '头孢克肟', trade_name: '世福素', aliases: '', category: 'antibiotic', ingredient: '头孢克肟', dosage_text: '0.1g', contraindication_note: '头孢类过敏者禁用', interaction_note: '用药及停药7天内禁酒' },
    ],
    records: [
      { record_id: 'R01', elder: 'E01', drug: 'D02', dose: '10mg', frequency: '每日2次', start_date: '2026-01-01', end_date: '2026-12-31' },
      { record_id: 'R02', elder: 'E01', drug: 'D03', dose: '0.5g', frequency: '每日2次', start_date: '2026-01-01', end_date: '2026-12-31' },
      { record_id: 'R03', elder: 'E02', drug: 'D04', dose: '100mg', frequency: '每日1次', start_date: '2026-03-01', end_date: '2026-12-31' },
      { record_id: 'R04', elder: 'E03', drug: 'D01', dose: '0.5g', frequency: '每日3次', start_date: '2026-07-10', end_date: '2026-07-17' },
      { record_id: 'R05', elder: 'E04', drug: 'D02', dose: '10mg', frequency: '每日2次', start_date: '2026-02-01', end_date: '2026-12-31' },
    ],
    reminders: [
      { rule_id: 'T01', elder: 'E01', medication_record: 'R01', remind_time: '早8:00', status: 'pending', voice_text: '李秀兰，该服降压药硝苯地平了' },
      { rule_id: 'T02', elder: 'E01', medication_record: 'R02', remind_time: '午12:00', status: 'pending', voice_text: '李秀兰，该服降糖药二甲双胍了' },
      { rule_id: 'T03', elder: 'E02', medication_record: 'R03', remind_time: '早8:00', status: 'pending', voice_text: '王建国，该服抗血小板阿司匹林了' },
      { rule_id: 'T04', elder: 'E03', medication_record: 'R04', remind_time: '早8:00', status: 'pending', voice_text: '张桂芳，该服抗生素阿莫西林了' },
      { rule_id: 'T05', elder: 'E04', medication_record: 'R05', remind_time: '晚20:00', status: 'pending', voice_text: '陈志远，该服降压药硝苯地平了' },
    ],
    contraindications: [
      { relation_id: 'C01', drug_a: 'D04', drug_b: '', drug_b_text: '布洛芬', contra_type: 'co_administration', severity: 'severe', note: '增加消化道出血风险' },
      { relation_id: 'C02', drug_a: 'D02', drug_b: '', drug_b_text: '西柚', contra_type: 'diet', severity: 'middle', note: '西柚升高血药浓度致低血压' },
      { relation_id: 'C03', drug_a: 'D03', drug_b: '', drug_b_text: '酒精', contra_type: 'diet', severity: 'severe', note: '乳酸酸中毒风险' },
      { relation_id: 'C04', drug_a: 'D05', drug_b: '', drug_b_text: '酒精', contra_type: 'diet', severity: 'severe', note: '双硫仑样反应' },
      { relation_id: 'C05', drug_a: 'D01', drug_b: '', drug_b_text: '活菌制剂', contra_type: 'co_administration', severity: 'light', note: '抗菌药灭活益生菌' },
    ],
  }
}

module.exports = { dictionaries, createSeedData }
