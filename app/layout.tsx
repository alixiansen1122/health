import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "健康与运动",
    template: "%s · 健康与运动",
  },
  description: "个人饮食、运动计划与每日健康记录。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "健康与运动",
    description: "记录饮食与运动，看见每天的变化",
    images: ["/og.jpg"],
  },
  twitter: {
    card: "summary_large_image",
    title: "健康与运动",
    description: "记录饮食与运动，看见每天的变化",
    images: ["/og.jpg"],
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  return host ? { metadataBase: new URL(`${protocol}://${host}`) } : {};
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
