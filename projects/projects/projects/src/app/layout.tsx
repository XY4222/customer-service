import type { Metadata } from "next";
import { cn } from "@/lib/utils";
import "./globals.css";
import Link from "next/link";
import Script from "next/script";
import { Toaster } from "@/components/ui/sonner";
import { AppNav } from "@/components/app-nav";
import { RuntimeBanner } from "@/components/runtime-banner";

export const metadata: Metadata = {
  title: "小食铺 AI 客服 · SnackOps",
  description: "零食电商客服 Plan + Skill 可配置执行平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased text-foreground"
        )}
      >
        <AppNav />
        <RuntimeBanner />
        <main className="min-h-[calc(100vh-3.5rem)] w-full px-4 sm:px-6 lg:px-8 py-6 mx-auto max-w-[1440px]">{children}</main>
        <Toaster position="top-right" />
        <Script id="theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}`}
        </Script>
      </body>
    </html>
  );
}
