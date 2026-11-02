import type { Metadata } from "next";
import "./globals.css";
import { NearProvider } from '@/providers/near-provider';

export const metadata: Metadata = {
  title: "CareCart · Procurement workspace",
  description: "Synthetic healthcare procurement: inventory, forecasts, quotes and auditable purchase orders.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col"><NearProvider>{children}</NearProvider></body>
    </html>
  );
}
