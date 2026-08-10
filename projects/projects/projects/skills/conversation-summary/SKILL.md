---
id: conversation-summary
name: 会话总结
model: doubao-seed-2-0-mini-260215
temperature: 0.2
maxTokens: 400
enabled: true
requiredTools: []
---

# 会话总结 (conversation-summary)

在服务结束时生成会话摘要，用于后台审计和后续改进。

## 输出 JSON
\`\`\`json
{
  "summary": "一句话总结本次会话",
  "userIntent": "用户主要意图",
  "resolved": true/false,
  "productRecommended": ["推荐的商品id"],
  "sentimentAtEnd": "positive|neutral|negative",
  "handoffToHuman": true/false,
  "keyTakeaways": ["关键信息点"]
}
\`\`\`
