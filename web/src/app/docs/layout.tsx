import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { DocsBrand } from "@/components/docs/brand";
import { docsSource } from "@/lib/docs-source";
import "@/components/docs/docs.css";

export default function ProductDocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="carecart-docs" id="main-content">
      <RootProvider theme={{ enabled: false }} search={{ options: { api: "/docs-search" } }}>
        <DocsLayout
          tree={docsSource.getPageTree()}
          nav={{ title: <DocsBrand />, url: "/", mode: "top" }}
          links={[
            { text: "Product site", url: "/" },
            { text: "Open clinic app", url: "/app" },
          ]}
          themeSwitch={{ enabled: false }}
        >
          {children}
        </DocsLayout>
      </RootProvider>
    </div>
  );
}
