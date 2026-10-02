"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  MessageSquare,
  Bot,
  Wrench,
  GitBranch,
  BarChart3,
  Database,
  Menu,
  X,
  Sparkles,
  Cpu,
  Brain,
  UserRound,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/demo", label: "聊天 Demo", icon: MessageSquare, section: "产品" },
  { href: "/", label: "Agent 控制台", icon: Bot, section: "产品" },
  { href: "/skills", label: "Skills", icon: Sparkles, section: "配置" },
  { href: "/tools", label: "Tools", icon: Wrench, section: "配置" },
  { href: "/planner", label: "Planner", icon: GitBranch, section: "配置" },
  { href: "/models", label: "模型管理", icon: Cpu, section: "配置" },
  { href: "/ops", label: "运营中心", icon: BarChart3, section: "运营" },
  { href: "/handoff", label: "坐席工作台", icon: UserRound, section: "运营" },
  { href: "/memory", label: "记忆管理", icon: Brain, section: "运营" },
  { href: "/catalog", label: "数据中心", icon: Database, section: "运营" },
];

export function AppNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-6">
        <Link href="/demo" className="flex items-center gap-2 shrink-0">
          <span className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
            小
          </span>
          <span className="font-semibold text-base tracking-tight">小食铺</span>
          <span className="text-[11px] text-muted-foreground bg-muted rounded px-1.5 py-0.5 hidden sm:inline-block">
            SnackOps
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-0.5 flex-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors whitespace-nowrap",
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          className="md:hidden ml-auto p-2 -mr-2"
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-border bg-card">
          <nav className="px-4 py-2 flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href ||
                    pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}
