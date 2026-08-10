"use client";

import { useEffect, useState } from "react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const DATA_TYPES = [
  { key: "products", label: "商品", itemKeys: ["products"], plural: "products" },
  { key: "activities", label: "活动", itemKeys: ["activities"], plural: "activities" },
  { key: "coupons", label: "优惠券", itemKeys: ["coupons"], plural: "coupons" },
  { key: "orders", label: "订单", itemKeys: ["orders"], plural: "orders" },
  { key: "returnPolicies", label: "售后政策", itemKeys: ["policies"], plural: "policies" },
] as const;

type DataType = typeof DATA_TYPES[number]["key"];

export default function CatalogPage() {
  const [activeTab, setActiveTab] = useState<DataType>("products");
  const [data, setData] = useState<Record<string, any>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState("");

  const load = async (key: DataType) => {
    const res = await fetch(`/api/catalog?type=${key}`).then((r) => r.json());
    setData((d) => ({ ...d, [key]: res.data }));
  };

  useEffect(() => {
    DATA_TYPES.forEach((dt) => load(dt.key));
  }, []);

  const save = async (key: DataType, newArr: any[]) => {
    const wrapperKey = DATA_TYPES.find((d) => d.key === key)!.itemKeys[0];
    await fetch(`/api/catalog?type=${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [wrapperKey]: newArr }),
    });
    await load(key);
    toast.success("已保存");
  };

  const getArr = (key: DataType): any[] => {
    const dt = DATA_TYPES.find((d) => d.key === key)!;
    const v = data[key];
    if (Array.isArray(v)) return v;
    for (const k of dt.itemKeys) {
      if (v && Array.isArray(v[k])) return v[k];
    }
    return [];
  };

  const startEdit = (item: any) => {
    setEditing(item.id || item.orderId || item.policyId || JSON.stringify(item).slice(0, 20));
    setEditValue(JSON.stringify(item, null, 2));
  };

  const saveEdit = (key: DataType) => {
    try {
      const parsed = JSON.parse(editValue);
      const arr = getArr(key);
      const idKey = parsed.id ? "id" : parsed.orderId ? "orderId" : "policyId";
      const idx = arr.findIndex((x: any) => (x[idKey] || x.id) === (parsed[idKey] || parsed.id));
      if (idx >= 0) arr[idx] = parsed;
      else arr.push(parsed);
      save(key, arr);
      setEditing(null);
    } catch (e: any) {
      toast.error("JSON 格式错误: " + e.message);
    }
  };

  const del = (key: DataType, id: string) => {
    const arr = getArr(key).filter((x: any) => (x.id || x.orderId || x.policyId) !== id);
    save(key, arr);
  };

  const addItem = (key: DataType) => {
    try {
      const parsed = JSON.parse(addValue);
      const arr = getArr(key);
      arr.push(parsed);
      save(key, arr);
      setAdding(false);
      setAddValue("");
    } catch (e: any) {
      toast.error("JSON 格式错误: " + e.message);
    }
  };

  const itemId = (x: any) => x.id || x.orderId || x.policyId || "?";
  const itemLabel = (x: any) => x.name || x.title || x.orderId || x.scenario || itemId(x);

  return (
    <div className="max-w-full py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">数据中心</h1>
        <p className="text-muted-foreground text-sm mt-1">
          管理本地模拟数据：商品、活动、优惠券、订单、售后政策
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DataType)}>
        <TabsList>
          {DATA_TYPES.map((dt) => (
            <TabsTrigger key={dt.key} value={dt.key}>{dt.label} ({getArr(dt.key).length})</TabsTrigger>
          ))}
        </TabsList>

        {DATA_TYPES.map((dt) => (
          <TabsContent key={dt.key} value={dt.key} className="mt-4 space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">{dt.label}列表 · 共 {getArr(dt.key).length} 条</p>
              <Button size="sm" onClick={() => setAdding(true)}>+ 新增</Button>
            </div>

            {adding && (
              <Card>
                <CardHeader><CardTitle className="text-base">新增{dt.label}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <Textarea value={addValue} onChange={(e) => setAddValue(e.target.value)} rows={8} placeholder="粘贴 JSON 对象..." />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => addItem(dt.key)}>保存</Button>
                    <Button size="sm" variant="outline" onClick={() => setAdding(false)}>取消</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-3">
              {getArr(dt.key).map((item: any) => {
                const id = itemId(item);
                const isEditing = editing === id;
                return (
                  <Card key={id}>
                    <CardHeader className="py-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          {itemLabel(item)}
                          {item.enabled === false && <Badge variant="secondary" className="text-[10px]">已停用</Badge>}
                          {item.status && <Badge variant="outline" className="text-[10px]">{item.status}</Badge>}
                          {item.price && <Badge className="bg-primary/10 text-primary border-0 text-[10px]">¥{item.price}</Badge>}
                        </CardTitle>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => startEdit(item)}>编辑</Button>
                          <Button size="sm" variant="destructive" onClick={() => del(dt.key, id)}>删除</Button>
                        </div>
                      </div>
                      {item.description && <CardDescription className="text-xs">{item.description}</CardDescription>}
                    </CardHeader>
                    {isEditing && (
                      <CardContent>
                        <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={12} className="font-mono text-xs" />
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" onClick={() => saveEdit(dt.key)}>保存</Button>
                          <Button size="sm" variant="outline" onClick={() => setEditing(null)}>取消</Button>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
