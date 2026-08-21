// Extended tools: query_order, query_return_policy, track_logistics, search_faq,
// query_user_profile, estimate_delivery, create_after_sales_ticket, reserve_stock, parse_address.
// These are loaded dynamically by runTool in tools.ts.
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { readCatalog } from "./store";
import { atomicWriteText } from "./fs-atomic";

const DATA_DIR = path.join(process.cwd(), "data");
async function readData<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
async function writeData<T>(file: string, data: T) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await atomicWriteText(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

/* ---------------- 1. 查询订单 ---------------- */
export async function queryOrderTool(input: { orderId?: string; userId?: string; phone?: string }) {
  const data = await readCatalog("orders");
  const all: any[] = (data as any).orders ?? [];
  let orders = [...all];
  if (input.orderId) orders = orders.filter((o) => o.orderId === input.orderId || o.id === input.orderId);
  if (input.userId) orders = orders.filter((o) => o.userId === input.userId);
  if (input.phone) {
    const tail = String(input.phone).slice(-4);
    orders = orders.filter((o) => {
      const addr = o.address || "";
      const m = addr.match(/(1\d{10})/);
      return m && m[1].slice(-4) === tail;
    });
  }
  if (orders.length === 0) return { matched: 0, message: "未找到对应订单，请确认订单号或下单手机号后4位" };
  // 附带物流摘要（不返回完整轨迹，避免 payload 过大）
  const ordersWithLogistics = await Promise.all(
    orders.map(async (o) => {
      if (!o.trackingNo) return { ...o, logisticsStatus: null };
      const lg = await readData<{ shipments: any[] }>("logistics.json", { shipments: [] });
      const s = lg.shipments.find((x) => x.trackingNo === o.trackingNo);
      return {
        ...o,
        logisticsStatus: s
          ? { carrier: s.carrier, status: s.status, latestLocation: s.latestLocation, estimatedDelivery: s.estimatedDelivery }
          : { carrier: null, status: "待发货" },
      };
    }),
  );
  return { matched: ordersWithLogistics.length, orders: ordersWithLogistics };
}

/* ---------------- 2. 退换货政策 ---------------- */
export async function queryReturnPolicyTool(input: { category?: string; situation?: string }) {
  const data = await readCatalog("returnPolicies");
  let policies: any[] = (data as any).policies ?? [];
  if (input.category) {
    const c = input.category;
    policies = policies.filter((p) => p.category === c || p.category === "general");
  }
  if (input.situation) {
    const s = input.situation.toLowerCase();
    policies = policies.filter((p) =>
      (p.applicableScenarios || []).some((sc: string) => {
        const scL = sc.toLowerCase();
        return s.includes(scL) || scL.includes(s);
      }),
    );
  }
  return { matched: policies.length, policies };
}

/* ---------------- 3. 物流轨迹 ---------------- */
export async function trackLogisticsTool(input: { trackingNo?: string; orderId?: string }) {
  // 如果给的是 orderId，先查订单拿 trackingNo
  let trackingNo = input.trackingNo;
  if (!trackingNo && input.orderId) {
    const orderData = await readCatalog("orders");
    const order = (orderData as any).orders?.find((o: any) => o.orderId === input.orderId || o.id === input.orderId);
    if (order?.trackingNo) trackingNo = order.trackingNo;
  }
  if (!trackingNo) {
    return { found: false, message: "请提供运单号或订单号以查询物流" };
  }
  const lg = await readData<{ shipments: any[] }>("logistics.json", { shipments: [] });
  const s = lg.shipments.find((x) => x.trackingNo === trackingNo);
  if (!s) return { found: false, message: `未查询到运单 ${trackingNo} 的物流信息，请核对单号是否正确` };
  return { found: true, ...s };
}

/* ---------------- 4. FAQ 知识库搜索 ---------------- */
export async function searchFaqTool(input: { query: string; category?: string; limit?: number }) {
  const data = await readData<{ faqs: any[] }>("faq.json", { faqs: [] });
  let faqs = data.faqs;
  if (input.category) {
    faqs = faqs.filter((f) => f.category === input.category);
  }
  const q = String(input.query || "").trim().toLowerCase();
  if (!q) return { total: faqs.length, matched: 0, faqs: [] };
  // 简单分词（中文 2 字滑窗 + 英文单词）
  const tokens = new Set<string>();
  const zh = q.match(/[\u4e00-\u9fa5]{2,}/g);
  if (zh) {
    for (const w of zh) for (let len = 2; len <= Math.min(4, w.length); len++)
      for (let i = 0; i + len <= w.length; i++) tokens.add(w.slice(i, i + len));
  }
  const en = q.match(/[A-Za-z0-9]{2,}/g);
  if (en) en.forEach((t) => tokens.add(t.toLowerCase()));
  // 打分：命中标签权重高，命中问题次高，命中答案再次
  const scored = faqs.map((f) => {
    const bag = [
      ...(f.tags || []).map((t: string) => `T:${t.toLowerCase()}`),
      `Q:${f.question.toLowerCase()}`,
      `A:${(f.answer || "").toLowerCase()}`,
    ].join(" ");
    let score = 0;
    for (const t of tokens) {
      if (bag.includes(`t:${t}`)) score += 5;
      else if (bag.includes(t)) score += 1;
    }
    return { ...f, score };
  });
  const matched = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const limit = input.limit && input.limit > 0 ? input.limit : 3;
  return { total: data.faqs.length, matched: matched.length, faqs: matched.slice(0, limit) };
}

/* ---------------- 5. 用户画像 ---------------- */
export async function queryUserProfileTool(input: { userId?: string; phone?: string; isNewUser?: boolean }) {
  const data = await readData<{ users: any[] }>("users.json", { users: [] });
  let users = data.users;
  if (input.userId) users = users.filter((u) => u.userId === input.userId);
  if (input.phone) {
    const tail = String(input.phone).slice(-4);
    // mock：演示尾号匹配不到就回退到 u001
    users = users.filter((u) => u.userId === "u001");
  }
  if (input.isNewUser) {
    users = users.filter((u) => u.isNewUser);
  }
  if (users.length === 0) {
    // 未识别到用户档案时，返回匿名新客占位
    return {
      found: false,
      profile: {
        userId: null,
        level: "guest",
        isNewUser: true,
        totalSpent: 0,
        orderCount: 0,
        tags: ["新客"],
        allergies: [],
        note: "未查询到历史订单，按新客处理",
      },
    };
  }
  return { found: true, profile: users[0] };
}

/* ---------------- 6. 预估配送时效 ---------------- */
const WAREHOUSES = [
  { id: "wh_hz", city: "杭州", cover: ["浙江", "上海", "江苏", "安徽", "江西", "福建"] },
  { id: "wh_sh", city: "上海", cover: ["上海", "江苏", "浙江", "安徽", "山东"] },
  { id: "wh_gz", city: "广州", cover: ["广东", "广西", "福建", "海南", "湖南", "江西"] },
  { id: "wh_bj", city: "北京", cover: ["北京", "天津", "河北", "河南", "山东", "山西", "辽宁", "吉林", "黑龙江", "内蒙古"] },
  { id: "wh_cd", city: "成都", cover: ["四川", "重庆", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆"] },
];
const REMOTE = ["新疆", "西藏", "内蒙古", "青海", "宁夏", "海南"];

export async function estimateDeliveryTool(input: {
  address?: string;
  province?: string;
  city?: string;
  productIds?: string[];
  orderTime?: string;
}) {
  const province = input.province || extractProvince(input.address || "");
  // 选仓
  let warehouse = WAREHOUSES[0];
  if (province) {
    const hit = WAREHOUSES.find((w) => w.cover.some((p) => province.includes(p) || p.includes(province)));
    if (hit) warehouse = hit;
  }
  const isRemote = REMOTE.some((r) => (province || "").includes(r));
  // 估算天数
  const sameCity = input.city && input.city.includes(warehouse.city);
  let minDays = 1, maxDays = 2;
  if (sameCity) { minDays = 1; maxDays = 1; }
  else if (isRemote) { minDays = 4; maxDays = 7; }
  else if (warehouse.cover.slice(0, 3).some((p) => (province || "").includes(p))) { minDays = 1; maxDays = 2; }
  else { minDays = 2; maxDays = 3; }
  // 出库时间：当天 15 点前下单当天发，否则次日
  const now = input.orderTime ? new Date(input.orderTime) : new Date();
  const cutoff = new Date(now); cutoff.setHours(15, 0, 0, 0);
  const shipDate = new Date(now);
  if (now > cutoff) shipDate.setDate(shipDate.getDate() + 1);
  const deliveryMin = new Date(shipDate); deliveryMin.setDate(deliveryMin.getDate() + minDays);
  const deliveryMax = new Date(shipDate); deliveryMax.setDate(deliveryMax.getDate() + maxDays);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    warehouse: warehouse.city + "仓",
    warehouseId: warehouse.id,
    isRemote,
    shipDate: fmt(shipDate),
    estimatedDeliveryMin: fmt(deliveryMin),
    estimatedDeliveryMax: fmt(deliveryMax),
    businessDays: `${minDays}-${maxDays}`,
    tips: isRemote ? "偏远地区配送时效较长，建议提前下单" : sameCity ? "同城次日达" : "一般48小时内可达",
  };
}
function extractProvince(addr: string): string {
  const provs = ["北京","天津","上海","重庆","河北","山西","辽宁","吉林","黑龙江","江苏","浙江","安徽","福建","江西","山东","河南","湖北","湖南","广东","海南","四川","贵州","云南","陕西","甘肃","青海","内蒙古","广西","西藏","宁夏","新疆","香港","澳门","台湾"];
  for (const p of provs) if (addr.includes(p)) return p;
  return "";
}

/* ---------------- 7. 创建售后工单 ---------------- */
export async function createAfterSalesTicketTool(input: {
  orderId: string;
  type: "refund" | "exchange" | "resend" | "complaint" | "other";
  description: string;
  images?: string[];
  contactPhone?: string;
}) {
  if (!input.orderId) return { success: false, message: "请提供订单号" };
  if (!input.type || !["refund","exchange","resend","complaint","other"].includes(input.type)) {
    return { success: false, message: "工单类型必须是 refund/exchange/resend/complaint/other 之一" };
  }
  if (!input.description || input.description.length < 3) {
    return { success: false, message: "请详细描述问题，至少 3 个字" };
  }
  const typeLabel: Record<string, string> = {
    refund: "退款", exchange: "换货", resend: "补发", complaint: "投诉", other: "其他",
  };
  const file = "tickets.json";
  const data = await readData<{ tickets: any[] }>(file, { tickets: [] });
  const ticketId = "TK" + Date.now().toString(36).toUpperCase() + randomUUID().slice(0, 4);
  const now = new Date().toISOString();
  const ticket = {
    ticketId,
    orderId: input.orderId,
    type: input.type,
    typeLabel: typeLabel[input.type],
    description: input.description,
    images: input.images || [],
    contactPhone: input.contactPhone || null,
    status: "open",
    createdAt: now,
    promisedReplyBy: new Date(Date.now() + 8 * 3600 * 1000).toISOString(), // 8小时内首次响应
  };
  data.tickets.push(ticket);
  await writeData(file, data);
  return {
    success: true,
    ticketId,
    status: "open",
    typeLabel: ticket.typeLabel,
    promisedReplyBy: "8 小时内",
    message: `已为您创建${ticket.typeLabel}工单，工单号 ${ticketId}，客服将在 8 小时内联系您处理`,
  };
}

/* ---------------- 8. 锁定库存 ---------------- */
export async function reserveStockTool(input: { items: Array<{ productId: string; quantity: number }>; ttlMinutes?: number }) {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { success: false, message: "请提供要锁定的商品列表" };
  }
  const ttl = input.ttlMinutes && input.ttlMinutes > 0 ? input.ttlMinutes : 15;
  const productsData = await readCatalog("products");
  const all: any[] = Array.isArray(productsData) ? productsData : (productsData as any).products ?? [];
  const results = [];
  let allOk = true;
  for (const it of input.items) {
    const p = all.find((x) => x.id === it.productId);
    if (!p) {
      results.push({ productId: it.productId, ok: false, reason: "商品不存在" });
      allOk = false; continue;
    }
    if ((p.stock ?? 0) < it.quantity) {
      results.push({ productId: it.productId, name: p.name, ok: false, reason: `库存不足（剩余${p.stock}）` });
      allOk = false; continue;
    }
    results.push({ productId: it.productId, name: p.name, ok: true, lockedQty: it.quantity, unitPrice: p.price });
  }
  const expireAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();
  return {
    success: allOk,
    reservationId: allOk ? "RS" + Date.now().toString(36).toUpperCase() : null,
    ttlMinutes: ttl,
    expireAt: allOk ? expireAt : null,
    items: results,
    message: allOk ? `库存已锁定，${ttl} 分钟内未支付自动释放` : "部分商品库存不足，无法锁定",
  };
}

/* ---------------- 9. 解析收货地址 ---------------- */
export async function parseAddressTool(input: { raw: string }) {
  const raw = String(input.raw || "").trim();
  if (!raw) return { success: false, message: "请输入地址信息" };
  // 用正则做一个轻量解析（非 LLM 版本，覆盖大部分中文地址模式）
  const phoneMatch = raw.match(/(1[3-9]\d{9})/);
  const phone = phoneMatch ? phoneMatch[1] : null;
  // 邮编要先去掉手机号，避免误抓手机号后 6 位
  const rawForZip = phone ? raw.replace(phone, " ") : raw;
  const zipMatch = rawForZip.match(/(?<!\d)(\d{6})(?!\d)/);
  const zip = zipMatch ? zipMatch[1] : null;

  // 省
  const provs = ["北京市","天津市","上海市","重庆市","河北省","山西省","辽宁省","吉林省","黑龙江省","江苏省","浙江省","安徽省","福建省","江西省","山东省","河南省","湖北省","湖南省","广东省","海南省","四川省","贵州省","云南省","陕西省","甘肃省","青海省","内蒙古自治区","广西壮族自治区","西藏自治区","宁夏回族自治区","新疆维吾尔自治区","香港特别行政区","澳门特别行政区","台湾省","北京","天津","上海","重庆","河北","山西","辽宁","吉林","黑龙江","江苏","浙江","安徽","福建","江西","山东","河南","湖北","湖南","广东","海南","四川","贵州","云南","陕西","甘肃","青海","内蒙古","广西","西藏","宁夏","新疆"];
  let province = "";
  // 先从 raw 中剥掉 phone/zip/收件人前缀，避免"杭州市"被"浙江省"匹配吃掉后 city 取不到
  let rest = raw;
  if (phone) rest = rest.replace(phone, " ");
  if (zip) rest = rest.replace(zip, " ");
  rest = rest.replace(/收件人|收货人|联系人|名字|姓名|联系电话|手机号|电话|地址|邮编|[:：]/g, " ");
  for (const p of provs) {
    if (rest.includes(p)) {
      if (p.length <= 2 && ["北京","天津","上海","重庆"].includes(p)) {
        province = p + "市";
      } else if (p.length <= 2) {
        province = p + "省";
      } else {
        province = p.replace(/(壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区)$/, (m) => m === "自治区" ? m : "");
        if (!province.endsWith("省") && !province.endsWith("市") && !province.endsWith("自治区")) province += "省";
      }
      rest = rest.replace(p, " ").replace(p + "省", " ").replace(p + "市", " ").replace(p + "自治区", " ");
      break;
    }
  }
  // 市 / 区 简单提取（在省后面找第一个 X市，再找后面的 X区/县）
  const cityMatch = rest.match(/([\u4e00-\u9fa5]{2,4}市)/);
  const city = cityMatch ? cityMatch[1] : "";
  let rest2 = rest;
  if (city) rest2 = rest2.replace(city, " ");
  // 区/县：在去掉市之后再匹配，避免 "杭州市西湖区" 整体被吃掉
  const districtMatch = rest2.match(/([\u4e00-\u9fa5]{2,6}?[区县])/);
  const district = districtMatch ? districtMatch[1] : "";
  // 联系人：优先找 "收件人：xxx" / "联系人：xxx"
  let contact = "";
  const contactMatch = raw.match(/(?:收件人|联系人|收货人|名字|姓名)[：:\s]*([\u4e00-\u9fa5A-Za-z]{2,6})/);
  if (contactMatch) contact = contactMatch[1];
  // 详细地址：去掉省市区手机邮编联系人后剩下的
  let detail = rest;
  if (phone) detail = detail.replace(phone, "");
  if (zip) detail = detail.replace(zip, "");
  if (contact) detail = detail.replace(contact, "");
  if (city) detail = detail.replace(city, "");
  if (district) detail = detail.replace(district, "");
  detail = detail.replace(/[，,。、\s]+/g, " ").replace(/(收件人|联系人|收货人|名字|姓名|电话|手机|地址|邮编)[：:]?\s*/g, "").trim();

  return {
    success: true,
    parsed: {
      province: province || null,
      city: city || null,
      district: district || null,
      detail: detail || null,
      contact: contact || null,
      phone,
      zip,
    },
    confidence: province && city ? "high" : province ? "medium" : "low",
    missingFields: [
      !province ? "province" : null,
      !city ? "city" : null,
      !district ? "district" : null,
      !detail ? "detail" : null,
      !contact ? "contact" : null,
      !phone ? "phone" : null,
    ].filter(Boolean),
    message: province && city && contact && phone
      ? "地址解析完整"
      : "部分字段缺失，建议向用户确认",
  };
}
