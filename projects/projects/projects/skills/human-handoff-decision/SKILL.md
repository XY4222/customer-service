---
id: human-handoff-decision
name: 人工接管判断
model: doubao-seed-2-0-mini-260215
temperature: 0.1
maxTokens: 300
enabled: true
requiredTools: []
---

# 人工接管判断 (human-handoff-decision)

判断当前对话是否需要转人工客服。

## 需要转人工的情况
- 用户明确要求"转人工""找客服""打电话"
- 食品安全/异物/过敏反应等严重投诉
- 涉及退款金额争议
- AI 连续 2 次未能理解用户意图
- 用户情绪激烈（辱骂、威胁投诉到监管）
- 涉及订单异常复杂的售后

## 输出 JSON
\`\`\`json
{
  "needsHuman": true/false,
  "reason": "原因说明",
  "urgency": "low|medium|high",
  "handoffMessage": "转人工前的安抚语，needsHuman=false 时为 null"
}
\`\`\`
