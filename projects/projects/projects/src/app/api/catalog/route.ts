import { NextResponse } from "next/server";
import { readCatalog, writeCatalog } from "@/lib/store";

type CatalogKey = "products" | "activities" | "coupons" | "orders" | "returnPolicies";
const VALID = new Set<CatalogKey>(["products", "activities", "coupons", "orders", "returnPolicies"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as CatalogKey;
  if (!VALID.has(type)) return NextResponse.json({ error: "invalid type" }, { status: 400 });
  const data = await readCatalog(type);
  return NextResponse.json({ data });
}

export async function PUT(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as CatalogKey;
  if (!VALID.has(type)) return NextResponse.json({ error: "invalid type" }, { status: 400 });
  const body = await req.json();
  await writeCatalog(type, body);
  return NextResponse.json({ ok: true });
}
