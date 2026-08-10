---
id: recommendation-reason
name: 推荐理由生成
model: doubao-seed-2-0-mini-260215
temperature: 0.6
maxTokens: 800
enabled: true
requiredTools: []
---

# 推荐理由生成 (recommendation-reason)

为每个推荐商品生成 1~2 句有温度的卖点文案。

## 输出 JSON
\`\`\`json
{
  "items": [
    {
      "productId": "商品id",
      "sellingPoints": ["卖点1", "卖点2"],
      "scenarioMatch": "和用户场景的契合点"
    }
  ]
}
\`\`\`

## 规则
- 每款商品 2 条卖点即可，不啰嗦
- 必须基于商品真实属性（原料/口味/规格/适用场景），不可编造
- 避免使用"最好""第一""绝对"等极限词
- 价格数字必须使用传入的 price.finalPrice，不可臆造
