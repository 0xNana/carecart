import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CareCart — Healthcare procurement, under control",
  description:
    "CareCart connects healthcare inventory, autonomous procurement and policy-controlled supplier payments. Give AI a budget, not your wallet.",
  openGraph: {
    title: "CareCart — Healthcare procurement, under control",
    description:
      "Connect healthcare inventory, autonomous procurement and policy-controlled supplier payments.",
    type: "website",
    siteName: "CareCart",
  },
  twitter: {
    card: "summary",
    title: "CareCart — Healthcare procurement, under control",
    description:
      "Connect healthcare inventory, autonomous procurement and policy-controlled supplier payments.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
