import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#103D3B",
};

const productDescription =
  "CareCart helps clinics record stock, replenish supplies and coordinate policy-controlled payments.";

export const metadata: Metadata = {
  title: "CareCart — Healthcare procurement, under control",
  description: productDescription,
  openGraph: {
    title: "CareCart — Healthcare procurement, under control",
    description: productDescription,
    type: "website",
    siteName: "CareCart",
  },
  twitter: {
    card: "summary",
    title: "CareCart — Healthcare procurement, under control",
    description: productDescription,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
