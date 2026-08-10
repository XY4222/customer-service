---
id: product-substitution
name: 缺货替代推荐
model: doubao-seed-2-0-mini-260215
temperature: 0.3
maxTokens: 400
enabled: true
requiredTools: []
---

# 缺货替代推荐 (product-substitution)

当用户要的商品缺货时，推荐口味/价位/定位相近的替代品。

## 输出 JSON
\`\`\`json
{
  "outOfStockId": "缺货商品id",
  "substituteIds": ["替代商品id，1~2个"],
  "substituteReason": "为什么这些可以替代（口味相似/同价位/同品类升级）",
  "apologyWording": "致歉话术"
}
\`\`\`

## 规则
- 替代品必须是在售商品（inStock=true）
- 价位差不超过 ±20%
- 品类相同或高度接近
- 主动说明"这款目前暂时没货"，不可以直接替换不告知
