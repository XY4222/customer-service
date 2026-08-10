---
id: recommendation-decision
name: 商品推荐决策
model: doubao-seed-2-0-lite-260215
temperature: 0.3
maxTokens: 600
enabled: true
requiredTools: []
---

# 商品推荐决策 (recommendation-decision)

基于已筛选的商品池和用户需求，选择 1~3 个最合适的商品推荐。

## 输入
- 用户需求（结构化字段）
- 已过滤的候选商品列表

## 输出 JSON
\`\`\`json
{
  "selectedProductIds": ["商品id数组，1~3个"],
  "reasoning": "为什么选这些商品的简要思路",
  "needsClarification": false,
  "clarificationQuestion": "如果需求不明确需要追问的问题，否则为 null"
}
\`\`\`

## 规则
- 严格使用候选池中出现的商品 id，不允许编造
- 用户指定了预算时，严格不超过预算（取 finalPrice 而非 originalPrice）
- 送礼场景优先选礼盒
- 办公室场景优先小包/独立包装/低异味
- 儿童场景禁止含酒精、过辣、过硬食品
- 如果完全没有匹配商品，返回空数组并设置 needsClarification=true
