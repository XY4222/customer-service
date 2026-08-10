---
id: allergy-risk-reminder
name: 过敏风险提醒
model: doubao-seed-2-0-mini-260215
temperature: 0.2
maxTokens: 400
enabled: true
requiredTools: []
---

# 过敏风险提醒 (allergy-risk-reminder)

检查推荐商品是否存在过敏原风险，并生成必要的提示语。

## 常见过敏原
- 坚果类（花生、核桃、杏仁、腰果）
- 乳制品（牛奶、奶粉、芝士、黄油）
- 麸质（小麦、大麦、燕麦）
- 大豆
- 海鲜类（鱼、虾、蟹、海苔）
- 蛋类

## 输出 JSON
\`\`\`json
{
  "hasRisk": true/false,
  "allergensFound": ["过敏原名称"],
  "warningText": "中文提醒语，或 null（无风险时）"
}
\`\`\`
