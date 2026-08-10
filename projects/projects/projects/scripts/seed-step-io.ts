/**
 * 根据 step ref + 用户问题 q + 场景 s，生成贴近业务的 input/output
 * 保证 Run 详情页展开看到的不是 `{}` / `{ok:true}` 的占位
 */
export function buildStepIO(
  ref: string,
  q: string,
  s: {
    final?: string;
    risk?: { issues?: any[] };
    failedStepRef?: string;
    degraded?: boolean;
    failedStepError?: string;
  },
  isFailed: boolean
): { input: unknown; output: unknown; thinking?: string } {
  // 失败/降级的 step：输出 null，并保留 error 字符串；input 依然构造有意义的参数
  const makeFail = (input: unknown) => ({
    input,
    output: null,
  });

  switch (ref) {
    case "need-extraction": {
      const input = {
        userMessage: q,
        context: { recentTurns: 0, channel: "web-demo" },
      };
      if (isFailed) return makeFail(input);
      // 从 q 猜几个字段，用一些启发式
      const lower = q.toLowerCase();
      let intent = "product_consult";
      let budget: number | null = null;
      const flavorTags: string[] = [];
      const budgetMatch = q.match(/(\d+)\s*块|(\d+)\s*元|预算\s*(\d+)/);
      if (budgetMatch) budget = parseInt(budgetMatch[1] || budgetMatch[2] || budgetMatch[3]);
      if (/推荐|什么|有啥|哪些/.test(q)) intent = "product_recommend";
      else if (/物流|快递|到哪|没到|发货/.test(q)) intent = "logistics_query";
      else if (/退款|退货|售后|坏了|赔/.test(q)) intent = "after_sales";
      else if (/过敏|不能吃|辣|糖/.test(q)) intent = "allergy_concern";
      if (/辣/.test(q)) flavorTags.push("spicy");
      if (/不辣/.test(q)) flavorTags.push("non-spicy");
      if (/糖/.test(q)) flavorTags.push("low-sugar");
      if (/便宜|性价比|学生|10\s*块|10\s*元/.test(q)) flavorTags.push("cheap");
      return {
        input,
        output: {
          intent,
          budget,
          flavorTags,
          quantity: null,
          addressProvided: /地址|送到|寄到/.test(q),
          timeUrgency: /今天|马上|急用/.test(q) ? "high" : "normal",
        },
      };
    }

    case "query_products": {
      const input: Record<string, unknown> = {
        filterBy: {
          category: "零食",
          inStock: true,
        },
      };
      const bm = q.match(/(\d+)\s*块|(\d+)\s*元|预算\s*(\d+)/);
      if (bm) {
        const b = parseInt(bm[1] || bm[2] || bm[3]);
        input.filterBy = { ...(input.filterBy as any), priceLte: b };
      }
      if (/辣/.test(q)) (input.filterBy as any).flavor = "spicy";
      if (/糖/.test(q)) (input.filterBy as any).lowSugar = true;
      if (isFailed) return makeFail(input);
      // 造一些合理的候选商品
      const products = [
        { id: "SKU001", name: "手作焦糖饼干（小袋）", price: 8.0, stock: 120, tags: ["甜", "饼干"] },
        { id: "SKU002", name: "辣味魔芋爽", price: 5.9, stock: 300, tags: ["辣", "素食"] },
        { id: "SKU003", name: "海苔脆片", price: 6.5, stock: 80, tags: ["海苔", "脆"] },
        { id: "SKU004", name: "无蔗糖坚果小方", price: 12.0, stock: 60, tags: ["无糖", "坚果"] },
        { id: "SKU005", name: "咸蛋黄鱼皮", price: 15.0, stock: 45, tags: ["咸", "鱼皮"] },
      ];
      let pick = products;
      if ((input.filterBy as any).priceLte) {
        pick = products.filter((p) => p.price <= (input.filterBy as any).priceLte);
      }
      if (pick.length === 0) pick = products.slice(0, 2);
      return { input, output: { count: pick.length, items: pick.slice(0, 3) } };
    }

    case "query_activities": {
      const input = { scope: "current", includeUpcoming: false };
      if (isFailed) return makeFail(input);
      return {
        input,
        output: {
          activities: [
            { id: "ACT2026_07", name: "开学季满减", rule: "满30减5", validUntil: "2026-09-10" },
            { id: "ACT2026_SPK", name: "辣味专区第二件半价", rule: "同SKU双份5折", validUntil: "2026-07-31" },
          ],
        },
      };
    }

    case "query_coupons": {
      const input = { userId: "u_demo_01", usableOnly: true };
      if (isFailed) return makeFail(input);
      return {
        input,
        output: {
          coupons: [
            { id: "CP001", name: "5元无门槛券", threshold: 0, amount: 5, expireAt: "2026-07-20" },
            { id: "CP003", name: "满20减3", threshold: 20, amount: 3, expireAt: "2026-07-31" },
          ],
        },
      };
    }

    case "recommendation-decision": {
      const input = {
        candidateSkuIds: ["SKU001", "SKU002", "SKU003"],
        userProfile: { level: "normal", allergies: [] as string[] },
        budgetHint: (q.match(/(\d+)\s*块|(\d+)\s*元/) ? parseInt(RegExp.$1 || RegExp.$2) : null) as number | null,
      };
      if (/不辣/.test(q)) input.userProfile.allergies.push("spicy");
      if (isFailed) return makeFail(input);
      const chosen = /辣/.test(q) ? "SKU002" : "SKU001";
      return {
        input,
        output: {
          chosenSkuId: chosen,
          reason:
            chosen === "SKU002"
              ? "用户偏好辣味，魔芋爽单价低、搭配5元无门槛券后价格落在预算内，库存充足。"
              : "焦糖饼干复购率高、价格符合预算，独立小包装适合课间垫肚子。",
          alternatives: ["SKU003"],
        },
        thinking:
          "综合预算/口味/库存/优惠力度四项打分，" +
          (chosen === "SKU002" ? "SKU002 在辣味偏好场景下得分最高，且第二件半价能提升客单。" : "SKU001 价格友好、适合作为首推，再搭配海苔作为备选。"),
      };
    }

    case "calculate_price": {
      // 选一个单价和优惠
      const unit = /辣/.test(q) ? 5.9 : 8.0;
      const qty = 1;
      const couponAmt = qty * unit <= 10 ? 5 : 0; // ≤10 元可叠加5元无门槛
      const input = {
        skuId: /辣/.test(q) ? "SKU002" : "SKU001",
        unitPrice: unit,
        quantity: qty,
        appliedCoupons: couponAmt > 0 ? [{ id: "CP001", amount: couponAmt }] : [],
        activityDiscount: 0,
      };
      if (isFailed) return makeFail(input);
      const finalPrice = Math.max(0, +(unit * qty - couponAmt).toFixed(2));
      return {
        input,
        output: {
          originalTotal: +(unit * qty).toFixed(2),
          discountTotal: couponAmt,
          finalTotal: finalPrice,
          breakdown: [
            { type: "商品", amount: +(unit * qty).toFixed(2) },
            { type: "优惠券", amount: -couponAmt },
          ],
        },
      };
    }

    case "recommendation-reason": {
      const input = {
        skuId: /辣/.test(q) ? "SKU002" : "SKU001",
        userQuestion: q,
        tone: "friendly",
      };
      if (isFailed) return makeFail(input);
      return {
        input,
        output: {
          sellingPoints:
            /辣/.test(q)
              ? ["劲辣开胃", "独立小包装不脏手", "用券后5元以下"]
              : ["焦糖香浓郁不腻", "小袋装一次一包", "学生党友好价"],
          avoidPhrases: ["最便宜", "全网最低价"],
        },
      };
    }

    case "response-generator": {
      const input = {
        structured: { intent: /辣/.test(q) ? "product_recommend" : "product_recommend" },
        recommendation: {
          skuName: /辣/.test(q) ? "辣味魔芋爽" : "手作焦糖饼干小袋",
          finalPrice: /辣/.test(q) ? 0.9 : 8.0,
        },
        userQuestion: q,
      };
      if (isFailed) return makeFail(input);
      return {
        input,
        output: {
          text: s.final || "可以试试手作焦糖饼干小袋8元，用5元无门槛券后更划算哦～",
          tone: "friendly",
          suggestions: [
            { label: "看下详情", action: "open_sku", payload: { skuId: "SKU001" } },
          ],
        },
      };
    }

    case "risk-check": {
      const input = {
        reply: s.final || "",
        userMessage: q,
        checkItems: ["price_commitment", "medical_claim", "forbidden_words", "allergy_miss"],
      };
      if (isFailed) return makeFail(input);
      const risk: any = s.risk || { passed: true, issues: [], riskLevel: "low" };
      return {
        input,
        output: {
          passed: risk.passed !== false,
          riskLevel: risk.riskLevel || "low",
          issues: (risk.issues || []).map((i: any) => (typeof i === "string" ? { detail: i } : i)),
        },
      };
    }

    case "track_logistics": {
      const input = { orderId: q.match(/ORD\d+/)?.[0] || "ORD20260712001" };
      if (isFailed) return makeFail(input);
      return {
        input,
        output: {
          status: "in_transit",
          latestNode: { time: "2026-07-15 09:20", location: "杭州转运中心", action: "已发出" },
          estimatedDelivery: "2026-07-16 18:00",
          carrier: "中通快递",
        },
      };
    }
    case "search_faq": {
      const input = { query: q, topK: 3 };
      if (isFailed) return makeFail(input);
      return {
        input,
        output: {
          hits: [
            { id: "FAQ001", title: "多久能到货？", answer: "一般1-3天，偏远地区5-7天。" },
          ],
        },
      };
    }
    case "query_user_profile": {
      const input = { userId: "u_demo_01" };
      if (isFailed) return makeFail(input);
      return { input, output: { level: "normal", tags: ["学生"] } };
    }
    case "estimate_delivery": {
      const input = { address: "浙江省杭州市西湖区" };
      if (isFailed) return makeFail(input);
      return { input, output: { warehouse: "杭州仓", etaHours: 24, isRemote: false } };
    }
    case "create_after_sales_ticket": {
      const input = { orderId: "ORD20260712001", reason: "未收到货" };
      if (isFailed) return makeFail(input);
      return { input, output: { ticketId: "AS20260715001", promisedReplyInHours: 8 } };
    }
    case "reserve_stock": {
      const input = { skuId: "SKU001", qty: 1 };
      if (isFailed) return makeFail(input);
      return { input, output: { reserved: true, holdUntil: "2026-07-15T22:00:00+08:00" } };
    }
    case "parse_address": {
      const input = { raw: "浙江省杭州市西湖区文三路 张三 13800000000" };
      if (isFailed) return makeFail(input);
      return {
        input,
        output: {
          province: "浙江省", city: "杭州市", district: "西湖区",
          street: "文三路", name: "张三", phone: "13800000000",
          confidence: 0.92,
        },
      };
    }
    case "after-sales-classification":
    case "allergy-risk-reminder":
    case "clarification-question":
    case "complaint-triage":
    case "conversation-summary":
    case "gift-scenario-advisor":
    case "human-handoff-decision":
    case "product-substitution": {
      const input = { userMessage: q };
      if (isFailed) return makeFail(input);
      return { input, output: { ok: true, note: "（该 Skill 输出已在汇总结果中体现）" } };
    }

    default: {
      const input = { userMessage: q };
      if (isFailed) return makeFail(input);
      return { input, output: { ok: true } };
    }
  }
}
