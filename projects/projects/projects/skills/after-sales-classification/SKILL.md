---
id: after-sales-classification
name: 售后问题分类
model: deepseek-chat
temperature: 0.1
maxTokens: 400
enabled: true
requiredTools: []
body: # 售后问题分类 (after-sales-classification)

将用户售后请求精确分类，匹配对应政策。

## 分类
- return_7days: 7天无理由退货
- exchange_quality: 质量问题换货
- refund_not_received: 未收货退款
- refund_damaged: 破损退款
- wrong_item: 错发漏发
- policy_inquiry: 政策咨询
- out_of_scope: 不在售后范围

## 输出 JSON
\`\`\`json
{
  "category": "类型枚举",
  "orderId": "订单号或 null",
  "eligible": true/false,
  "policyMatch": "对应政策条款说明",
  "nextStep": "告知用户下一步操作"
}
\`\`\`
description: 将用户售后请求精确分类，匹配对应政策。
effectiveModel: deepseek-chat
modelTranslated: true
---

# 售后问题分类 (after-sales-classification)

将用户售后请求精确分类，匹配对应政策。

## 分类
- return_7days: 7天无理由退货
- exchange_quality: 质量问题换货
- refund_not_received: 未收货退款
- refund_damaged: 破损退款
- wrong_item: 错发漏发
- policy_inquiry: 政策咨询
- out_of_scope: 不在售后范围

## 输出 JSON
\`\`\`json
{
  "category": "类型枚举",
  "orderId": "订单号或 null",
  "eligible": true/false,
  "policyMatch": "对应政策条款说明",
  "nextStep": "告知用户下一步操作"
}
\`\`\`