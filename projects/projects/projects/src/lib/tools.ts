import {
  readActivities,
  readCoupons,
  readOrders,
  readPolicies,
  readProducts,
} from "./store";

// ---- Type helpers (data file shapes) ----
type Product = Record<string, any>;
type Coupon = Record<string, any>;
type Activity = Record<string, any>;

const asProducts = (d: any): Product[] => Array.isArray(d) ? d : (d?.products ?? []);
const asActivities = (d: any): Activity[] => Array.isArray(d) ? d : (d?.activities ?? []);
const asCoupons = (d: any): Coupon[] => Array.isArray(d) ? d : (d?.coupons ?? []);

/**
 * Tool 1: 查询商品
 * 支持按关键词、品类、口味标签、场景、最大预算过滤
 */
export interface QueryProductsInput {
  keyword?: string;
  keywords?: string | string[];
  category?: string;
  flavorTags?: string[];
  scenario?: string;
  maxBudget?: number;
  budget?: number | { min?: number; max?: number } | null;
  limit?: number;
}

export async function queryProductsTool(input: QueryProductsInput) {
  const data = await readProducts();
  const all: Product[] = asProducts(data);
  let result: Product[] = [...all];

  if (input.category) {
    const allCategories = new Set(all.map((p) => p.category));
    // 精确匹配
    if (allCategories.has(input.category)) {
      result = result.filter((p) => p.category === input.category);
    } else {
      // 模糊匹配：把 category 字符串按分隔符切分成若干候选词，只要有一个词命中 category/tag/description 即保留
      const tokens = String(input.category)
        .split(/[\/、,，;；\s]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t.length < 10);
      if (tokens.length > 0) {
        result = result.filter((p) => {
          const bag = [p.category, ...(p.tags || []), p.description || ""]
            .join(" ")
            .toLowerCase();
          return tokens.some((t) => bag.includes(t.toLowerCase()));
        });
      }
      // 若拆词后仍无结果则不过滤（避免被奇怪分类值误杀全部结果）
    }
  }
  // 关键词：支持 keyword(string) 和 keywords(string|string[])，逐个做 OR 匹配
  // 先把形如 "办公室零食" 这类复合词再按中文/英文词边界拆出 2 字以上子串，提升召回
  const keywordList: string[] = [];
  const pushKw = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const s = raw.trim();
    if (!s) return;
    keywordList.push(s);
    // 中文 2~4 字滑窗；英文按空格拆
    const zh = s.match(/[\u4e00-\u9fa5]{2,}/g);
    if (zh) {
      for (const w of zh) {
        for (let len = 2; len <= Math.min(4, w.length); len++) {
          for (let i = 0; i + len <= w.length; i++) {
            const sub = w.slice(i, i + len);
            if (!keywordList.includes(sub)) keywordList.push(sub);
          }
        }
      }
    }
    const en = s.match(/[A-Za-z0-9]{2,}/g);
    if (en) keywordList.push(...en);
  };
  pushKw(input.keyword);
  pushKw(input.keywords as any);
  if (Array.isArray(input.keywords)) {
    for (const k of input.keywords) pushKw(k);
  }
  // 去重 + 优先短词在前（tag 通常是短词）
  const seen = new Set<string>();
  const uniqKeywords: string[] = [];
  for (const k of keywordList) {
    const kl = k.toLowerCase();
    if (seen.has(kl)) continue;
    seen.add(kl);
    uniqKeywords.push(k);
  }
  if (uniqKeywords.length > 0) {
    const kws = uniqKeywords.map((k) => k.toLowerCase());
    result = result.filter((p) =>
      kws.some((kw) =>
        p.name.toLowerCase().includes(kw) ||
        p.description.toLowerCase().includes(kw) ||
        p.tags.some((t: string) => t.toLowerCase().includes(kw)) ||
        p.category.toLowerCase().includes(kw)
      )
    );
  }
  if (input.flavorTags && input.flavorTags.length > 0) {
    result = result.filter((p) =>
      input.flavorTags!.some((tag) =>
        p.tags.some((t: string) => t.toLowerCase().includes(String(tag).toLowerCase()))
      )
    );
  }
  if (input.scenario) {
    const sc = String(input.scenario).toLowerCase();
    // 中英文/同义词映射：把 Planner/LLM 可能输出的英文场景词映射到商品库里的中文标签
    const scenarioAlias: Record<string, string[]> = {
      office: ["办公室", "办公", "下午茶"],
      travel: ["旅途", "出行", "便携"],
      gift: ["送礼", "礼盒", "节日"],
      home: ["居家", "零食", "家庭"],
      child: ["儿童", "孩子"],
      gift_her: ["送礼", "女生", "礼盒"],
      gift_him: ["送礼", "男生", "礼盒"],
      party: ["聚会", "分享"],
    };
    const alias = scenarioAlias[sc] || [sc];
    const scHits = [sc, ...alias].map((s) => s.toLowerCase());
    result = result.filter((p) => {
      const bag = [
        ...(p.suitableFor || []),
        ...(p.tags || []),
        p.category || "",
        p.description || "",
      ]
        .join(" ")
        .toLowerCase();
      return scHits.some((k) => bag.includes(k));
    });
  }
  // 预算上限：maxBudget 优先；若传 budget 对象，取 budget.max
  let maxBudget = input.maxBudget;
  if (maxBudget == null && typeof input.budget === "number") maxBudget = input.budget;
  if (maxBudget == null && input.budget && typeof input.budget === "object" && typeof (input.budget as any).max === "number") {
    maxBudget = (input.budget as any).max;
  }
  if (typeof maxBudget === "number" && maxBudget > 0) {
    result = result.filter((p) => p.price <= maxBudget!);
  }

  result = [...result].sort((a, b) => b.rating - a.rating);

  if (input.limit && input.limit > 0) {
    result = result.slice(0, input.limit);
  }

  return {
    totalMatched: result.length,
    products: result.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      price: p.price,
      stock: p.stock,
      rating: p.rating,
      tags: p.tags,
      suitableFor: p.suitableFor,
      description: p.description,
    })),
  };
}

/**
 * Tool 2: 查询活动
 */
export interface QueryActivitiesInput {
  category?: string;
  isNewUser?: boolean;
  minOrderAmount?: number;
}

export async function queryActivitiesTool(input: QueryActivitiesInput) {
  const data = await readActivities();
  const all: Activity[] = asActivities(data);
  const today = new Date().toISOString().slice(0, 10);

  let result = all.filter((a: Activity) => a.startDate <= today && a.endDate >= today);

  if (input.isNewUser) {
    result = result.filter(
      (a) => a.appliesTo === "new_user" || a.appliesTo === "all"
    );
  }
  if (input.category) {
    result = result.filter(
      (a) => a.appliesTo === "all" || a.category === input.category
    );
  }
  if (typeof input.minOrderAmount === "number" && input.minOrderAmount > 0) {
    result = result.filter(
      (a) => !a.threshold || a.threshold <= input.minOrderAmount!
    );
  }

  return {
    totalMatched: result.length,
    activities: result,
  };
}

/**
 * Tool 3: 查询优惠券
 */
export interface QueryCouponsInput {
  category?: string;
  minSpend?: number;
  isNewUser?: boolean;
}

export async function queryCouponsTool(input: QueryCouponsInput) {
  const data = await readCoupons();
  const all: Coupon[] = asCoupons(data);
  const today = new Date().toISOString().slice(0, 10);

  let result = all.filter((c: Coupon) => c.validUntil >= today);

  if (input.category) {
    result = result.filter(
      (c) =>
        c.applicableCategories.includes("all") ||
        c.applicableCategories.includes(input.category!)
    );
  }
  if (typeof input.minSpend === "number") {
    result = result.filter((c) => c.minSpend <= input.minSpend!);
  }

  return {
    totalMatched: result.length,
    coupons: result,
  };
}

/**
 * Tool 4: 计算价格
 * 规则：
 * 1. 先按 category_discount 给分类打折
 * 2. 再按 full_reduction 满减
 * 3. 再叠加一个最优优惠券
 * 4. 全程保留明细
 */
export interface CalculatePriceInput {
  productIds: string[];
  couponId?: string;
  isNewUser?: boolean;
}

export interface CalculatePriceOutput {
  items: Array<{
    productId: string;
    name: string;
    category: string;
    originalPrice: number;
    finalUnitPrice: number;
    quantity: number;
  }>;
  subtotal: number;
  appliedActivities: Array<{ id: string; name: string; discount: number }>;
  appliedCoupon: { id: string; name: string; discount: number } | null;
  totalDiscount: number;
  finalPrice: number;
}

export async function calculatePriceTool(
  input: CalculatePriceInput
): Promise<CalculatePriceOutput> {
  const productsData = await readProducts();
  const activitiesData = await readActivities();
  const couponsData = await readCoupons();
  const products: Product[] = asProducts(productsData);
  const activities: Activity[] = asActivities(activitiesData);
  const coupons: Coupon[] = asCoupons(couponsData);
  const today = new Date().toISOString().slice(0, 10);

  const productIds = Array.isArray(input.productIds)
    ? input.productIds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  if (productIds.length === 0) {
    return {
      items: [],
      subtotal: 0,
      appliedActivities: [],
      appliedCoupon: null,
      totalDiscount: 0,
      finalPrice: 0,
    };
  }

  const selectedProducts = products.filter((p) =>
    productIds.includes(p.id)
  );

  // Step 1: 每个商品先按分类折扣调整单价
  const items = selectedProducts.map((p) => {
    let unitPrice = p.price;
    const matched = activities.find(
      (a) =>
        a.type === "category_discount" &&
        a.category === p.category &&
        a.startDate <= today &&
        a.endDate >= today &&
        a.discountRate
    );
    if (matched && matched.discountRate) {
      unitPrice = Number((p.price * matched.discountRate).toFixed(2));
    }
    return {
      productId: p.id,
      name: p.name,
      category: p.category,
      originalPrice: p.price,
      finalUnitPrice: unitPrice,
      quantity: 1,
    };
  });

  const subtotal = Number(
    items.reduce((sum, it) => sum + it.finalUnitPrice * it.quantity, 0).toFixed(2)
  );

  // Step 2: 满减活动
  const appliedActivities: CalculatePriceOutput["appliedActivities"] = [];
  let runningTotal = subtotal;
  const fullReductions = activities
    .filter(
      (a) =>
        a.type === "full_reduction" &&
        a.startDate <= today &&
        a.endDate >= today &&
        a.threshold &&
        a.discount
    )
    .sort((a, b) => (b.threshold! - a.threshold!));

  for (const act of fullReductions) {
    if (runningTotal >= act.threshold! && act.discount) {
      appliedActivities.push({
        id: act.id,
        name: act.name,
        discount: act.discount,
      });
      runningTotal = Number((runningTotal - act.discount).toFixed(2));
      break;
    }
  }

  // Step 3: 新客立减
  if (input.isNewUser) {
    const newUserAct = activities.find(
      (a) =>
        a.type === "new_user" &&
        a.startDate <= today &&
        a.endDate >= today &&
        a.appliesTo === "new_user" &&
        a.discount
    );
    if (newUserAct && newUserAct.discount) {
      appliedActivities.push({
        id: newUserAct.id,
        name: newUserAct.name,
        discount: newUserAct.discount,
      });
      runningTotal = Number((runningTotal - newUserAct.discount).toFixed(2));
    }
  }

  // Step 4: 优惠券
  // - 若 Planner 显式传入 couponId，则按指定使用
  // - 否则自动从可用券池里挑出"减得最多且满足门槛"的那一张
  let appliedCoupon: CalculatePriceOutput["appliedCoupon"] = null;
  const eligibleCoupons = coupons.filter(
    (c) =>
      c.validUntil >= today &&
      runningTotal >= c.minSpend &&
      (c.discount ?? 0) > 0
  );

  const evaluateCoupon = (coupon: Coupon) => {
    let d = 0;
    if (coupon.type === "no_threshold" || coupon.type === "threshold") {
      d = coupon.discount ?? 0;
    } else if (coupon.type === "category_rate" && coupon.discountRate) {
      const categoryItems = items.filter((it) =>
        coupon.applicableCategories.includes(it.category)
      );
      const categorySubtotal = categoryItems.reduce(
        (s, it) => s + it.finalUnitPrice * it.quantity,
        0
      );
      d = Number((categorySubtotal * (1 - coupon.discountRate)).toFixed(2));
    }
    return d;
  };

  let chosenCoupon: Coupon | null = null;
  if (input.couponId) {
    chosenCoupon = coupons.find((c) => c.id === input.couponId) ?? null;
  } else {
    let bestDiscount = 0;
    for (const c of eligibleCoupons) {
      const d = evaluateCoupon(c);
      if (d > bestDiscount) {
        bestDiscount = d;
        chosenCoupon = c;
      }
    }
  }

  if (chosenCoupon) {
    const couponDiscount = evaluateCoupon(chosenCoupon);
    if (couponDiscount > 0) {
      runningTotal = Number(
        Math.max(0, runningTotal - couponDiscount).toFixed(2)
      );
      appliedCoupon = {
        id: chosenCoupon.id,
        name: chosenCoupon.name,
        discount: couponDiscount,
      };
    }
  }

  const finalPrice = Number(Math.max(0, runningTotal).toFixed(2));
  const totalDiscount = Number((subtotal - finalPrice).toFixed(2));

  return {
    items,
    subtotal,
    appliedActivities,
    appliedCoupon,
    totalDiscount,
    finalPrice,
  };
}

/**
 * 工具元数据列表（供 Planner / 后台 Tools 页使用）
 * category 说明：
 * - data      数据查询：只读查库/查用户/查订单
 * - calc      计算解析：价格计算、时效估算、地址解析
 * - write     写入操作：创建工单、锁库存（有副作用）
 * - knowledge 知识库：FAQ、售后政策等知识检索
 * - external  外部服务：物流、第三方 API
 */
interface ToolMetaDef {
  id: ToolId;
  name: string;
  description: string;
  category: "data" | "calc" | "write" | "knowledge" | "external";
  parameters: Record<string, string>;
  demoInput: Record<string, unknown>;
}
export const TOOLS: ToolMetaDef[] = [
  {
    id: "query_products",
    name: "查询商品",
    description:
      "按关键词、品类、口味标签、场景、预算过滤商品。返回商品 id、名称、品类、价格、评分、标签、描述。",
    category: "data",
    parameters: {
      keyword: "string? 关键词（商品名/描述/标签）",
      category: "string? 品类，如 '坚果'、'巧克力'",
      flavorTags: "string[]? 口味标签，如 ['麻辣', '奶香']",
      scenario: "string? 使用场景，如 '办公室'、'送礼'",
      maxBudget: "number? 单品最大预算",
      limit: "number? 返回数量上限，默认 5",
    },
    demoInput: {
      keywords: ["麻辣", "办公室"],
      flavorTags: ["麻辣"],
      scenario: "office",
      maxBudget: 30,
      limit: 5,
    },
  },
  {
    id: "query_activities",
    name: "查询优惠活动",
    description:
      "查询当前生效的满减、品类折扣、新客立减活动。可按品类、是否新客、订单金额过滤。",
    category: "data",
    parameters: {
      category: "string? 品类",
      isNewUser: "boolean? 是否新客",
      minOrderAmount: "number? 订单金额下限",
    },
    demoInput: {
      category: "",
      isNewUser: false,
      minOrderAmount: 50,
    },
  },
  {
    id: "query_coupons",
    name: "查询优惠券",
    description:
      "查询当前生效的优惠券。可按适用品类、订单金额过滤。",
    category: "data",
    parameters: {
      category: "string? 品类",
      minSpend: "number? 订单金额下限",
      isNewUser: "boolean? 是否新客",
    },
    demoInput: {
      category: "",
      minSpend: 30,
    },
  },
  {
    id: "calculate_price",
    name: "计算价格",
    description:
      "传入商品 id 列表和（可选）优惠券 id，按品类折扣 → 满减 → 新客立减 → 优惠券 顺序计算最终价。返回完整明细。",
    category: "calc",
    parameters: {
      productIds: "string[] 必填，商品 id 列表",
      couponId: "string? 优惠券 id",
      isNewUser: "boolean? 是否新客",
    },
    demoInput: {
      productIds: ["prod_spicy_stick", "prod_nuts_pack"],
      isNewUser: false,
    },
  },
  {
    id: "query_order",
    name: "查询订单",
    description: "根据订单号或手机号查询订单状态、商品明细、支付金额，以及物流摘要（承运商/节点/预计送达）。",
    category: "data",
    parameters: {
      orderId: "string? 订单号",
      userId: "string? 用户 id",
      phone: "string? 手机号（匹配后4位）",
    },
    demoInput: {
      orderId: "ORD20240715001",
    },
  },
  {
    id: "query_return_policy",
    name: "退换货政策",
    description: "查询售后/退换货政策，可按品类或具体场景（破损/临期/过敏/发错货）过滤。",
    category: "knowledge",
    parameters: {
      category: "string? 商品品类",
      situation: "string? 售后场景",
    },
    demoInput: {
      category: "膨化食品",
      situation: "临期/破损",
    },
  },
  {
    id: "track_logistics",
    name: "查询物流轨迹",
    description: "根据运单号或订单号查询物流轨迹，返回承运商、当前状态、最新节点、轨迹列表、预计送达时间。",
    category: "external",
    parameters: {
      trackingNo: "string? 快递运单号",
      orderId: "string? 订单号（可自动查运单号）",
    },
    demoInput: {
      trackingNo: "SF1234567890",
    },
  },
  {
    id: "search_faq",
    name: "知识库搜索",
    description: "搜索内部 FAQ 知识库（发货/支付/售后/优惠/会员/配送/保质期/退换货等），返回最相关的标准答案，用于回答非商品类通用问题。",
    category: "knowledge",
    parameters: {
      query: "string 必填，用户问题关键词",
      category: "string? 限定分类（通用/支付/售后/优惠/会员/配送/商品）",
      limit: "number? 返回条数上限，默认 3",
    },
    demoInput: {
      query: "优惠券能叠加使用吗",
      category: "优惠",
      limit: 3,
    },
  },
  {
    id: "query_user_profile",
    name: "查询用户画像",
    description: "根据 userId 或手机号查询用户等级、累计消费、订单数、偏好标签、过敏信息，用于个性化推荐和过敏风险提示。",
    category: "data",
    parameters: {
      userId: "string? 用户 id",
      phone: "string? 手机号（后4位）",
      isNewUser: "boolean? 是否只查新客",
    },
    demoInput: {
      userId: "u001",
    },
  },
  {
    id: "estimate_delivery",
    name: "预估配送时效",
    description: "根据收货地址（省/市/自然语言地址均可）估算发货仓、出库日期、送达时间区间、是否偏远地区。",
    category: "calc",
    parameters: {
      address: "string? 自然语言收货地址",
      province: "string? 省份（可单独传）",
      city: "string? 城市",
      productIds: "string[]? 商品 id 列表（用于判断是否需冷藏/特殊处理）",
      orderTime: "string? 下单时间 ISO 字符串，默认当前时间",
    },
    demoInput: {
      address: "浙江省杭州市西湖区文三路 100 号",
    },
  },
  {
    id: "create_after_sales_ticket",
    name: "创建售后工单",
    description: "为用户创建退货/换货/补发/投诉/其他工单，返回工单号和承诺响应时间。必须提供订单号、类型、问题描述。",
    category: "write",
    parameters: {
      orderId: "string 必填，订单号",
      type: "string 必填，工单类型 refund|exchange|resend|complaint|other",
      description: "string 必填，用户问题描述",
      images: "string[]? 凭证图片 URL 列表",
      contactPhone: "string? 联系电话",
    },
    demoInput: {
      orderId: "ORD20240715001",
      type: "refund",
      description: "收到的商品包装破损，有渗漏，希望退款",
    },
  },
  {
    id: "reserve_stock",
    name: "锁定库存",
    description: "下单前锁定指定商品的库存（默认15分钟有效），返回锁定结果与过期时间。库存不足时返回失败原因。",
    category: "write",
    parameters: {
      items: "array 必填，要锁定的商品项 [{productId, quantity}]",
      ttlMinutes: "number? 锁定时长，默认 15 分钟",
    },
    demoInput: {
      items: [
        { productId: "prod_nuts_pack", quantity: 2 },
        { productId: "prod_spicy_stick", quantity: 1 },
      ],
      ttlMinutes: 15,
    },
  },
  {
    id: "parse_address",
    name: "解析收货地址",
    description: "把用户自然语言描述的收货地址解析为省/市/区/详细地址/联系人/手机号/邮编结构化字段，返回置信度和缺失字段。",
    category: "calc",
    parameters: {
      raw: "string 必填，用户输入的原始地址文本",
    },
    demoInput: {
      raw: "收件人示例 浙江省杭州市西湖区示例路1号",
    },
  },
];

export type ToolId =
  | "query_products"
  | "query_activities"
  | "query_coupons"
  | "calculate_price"
  | "query_order"
  | "query_return_policy"
  | "track_logistics"
  | "search_faq"
  | "query_user_profile"
  | "estimate_delivery"
  | "create_after_sales_ticket"
  | "reserve_stock"
  | "parse_address";

export async function executeTool(
  toolId: ToolId,
  input: Record<string, unknown>
) {
  switch (toolId) {
    case "query_products":
      return await queryProductsTool(input as QueryProductsInput);
    case "query_activities":
      return await queryActivitiesTool(input as QueryActivitiesInput);
    case "query_coupons":
      return await queryCouponsTool(input as QueryCouponsInput);
    case "calculate_price":
      return await calculatePriceTool(input as unknown as CalculatePriceInput);
    case "query_order": {
      const { queryOrderTool } = await import("./tools-ex");
      return await queryOrderTool(input as { orderId?: string; userId?: string; phone?: string });
    }
    case "query_return_policy": {
      const { queryReturnPolicyTool } = await import("./tools-ex");
      return await queryReturnPolicyTool(input as { category?: string; situation?: string });
    }
    case "track_logistics": {
      const { trackLogisticsTool } = await import("./tools-ex");
      return await trackLogisticsTool(input as { trackingNo?: string; orderId?: string });
    }
    case "search_faq": {
      const { searchFaqTool } = await import("./tools-ex");
      return await searchFaqTool(input as { query: string; category?: string; limit?: number });
    }
    case "query_user_profile": {
      const { queryUserProfileTool } = await import("./tools-ex");
      return await queryUserProfileTool(input as { userId?: string; phone?: string; isNewUser?: boolean });
    }
    case "estimate_delivery": {
      const { estimateDeliveryTool } = await import("./tools-ex");
      return await estimateDeliveryTool(input as { address?: string; province?: string; city?: string; productIds?: string[]; orderTime?: string });
    }
    case "create_after_sales_ticket": {
      const { createAfterSalesTicketTool } = await import("./tools-ex");
      return await createAfterSalesTicketTool(input as { orderId: string; type: "refund"|"exchange"|"resend"|"complaint"|"other"; description: string; images?: string[]; contactPhone?: string });
    }
    case "reserve_stock": {
      const { reserveStockTool } = await import("./tools-ex");
      return await reserveStockTool(input as { items: Array<{ productId: string; quantity: number }>; ttlMinutes?: number });
    }
    case "parse_address": {
      const { parseAddressTool } = await import("./tools-ex");
      return await parseAddressTool(input as { raw: string });
    }
    default:
      throw new Error(`Unknown tool: ${toolId}`);
  }
}

export async function runTool(toolId: string, input: Record<string, unknown>) {
  return executeTool(toolId as ToolId, input);
}

export interface ToolCatalogItem {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  parameters: Array<{ name: string; type: string; required: boolean; description: string }>;
}

export function getToolCatalog(): ToolCatalogItem[] {
  // 解析 TOOLS 中的 parameters 字符串为结构化对象
  const parseParams = (paramStr: Record<string, string>) => {
    return Object.entries(paramStr).map(([name, desc]) => {
      const required = !desc.includes("?");
      const cleanDesc = desc.replace("?", "");
      // 简单提取类型
      const typeMatch = cleanDesc.match(/^(\w+)\??/);
      const type = typeMatch ? typeMatch[1] : "string";
      const description = cleanDesc.replace(/^\w+\??\s*/, "");
      return { name, type: type === "string[]" ? "array" : type, required, description };
    });
  };

  return TOOLS.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    enabled: true,
    parameters: parseParams(t.parameters as unknown as Record<string, string>),
  }));
}
