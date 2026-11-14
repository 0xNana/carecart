import {siteOrigins} from '@/lib/application-routing';
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocumentationProvider } from "@/components/docs/provider";
import type { ReactNode } from "react";
import { DocsBrand } from "@/components/docs/brand";
import { docsSource } from "@/lib/docs-source";
import "@/components/docs/docs.css";

export default function ProductDocsLayout({ children }: { children: ReactNode }) {
  const origins=siteOrigins();
  return (
    <div className="carecart-docs" id="main-content">
      <DocumentationProvider subdomain={!!origins}>
        <DocsLayout
          tree={docsSource.getPageTree()}
          nav={{ title: <DocsBrand />, url: origins ? "/" : "/docs" }}
          links={[
            { text: "Product site", url: origins?.site ?? "/" },
            { text: "Open clinic app", url: origins ? origins.app+"/" : "/app" },
          ]}
          sidebar={{ collapsible: false }}
          themeSwitch={{ enabled: false }}
        >
          {children}
        </DocsLayout>
      </DocumentationProvider>
    </div>
  );
}
