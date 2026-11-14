import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { getMDXComponents } from "@/components/docs/mdx-components";
import { documentationPublicPath, siteOrigins } from "@/lib/application-routing";
import { docsSource } from "@/lib/docs-source";

type DocsRouteProps = PageProps<"/docs/[[...slug]]">;

export default function Page(props: DocsRouteProps) {
  return (
    <Suspense fallback={<DocsLoading />}>
      <DocumentationPage params={props.params} />
    </Suspense>
  );
}

async function DocumentationPage({ params }: Pick<DocsRouteProps, "params">) {
  const { slug } = await params;
  const page = docsSource.getPage(slug);
  if (!page) notFound();
  const Body = page.data.body;

  return (
    <DocsPage toc={page.data.toc} tableOfContent={{ style: "clerk" }}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <Body components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

function DocsLoading() {
  return (
    <main className="grid [grid-area:main]" data-layout-main="">
      <article
        id="nd-page"
        data-layout-content=""
        aria-busy="true"
        className="flex min-w-0 flex-col gap-4 px-4 py-6 md:px-6 md:pt-8 xl:px-8 xl:pt-14"
      >
        <p role="status" aria-live="polite">Loading documentation…</p>
      </article>
    </main>
  );
}

export function generateStaticParams() {
  return docsSource.generateParams();
}

export async function generateMetadata(
  props: DocsRouteProps,
): Promise<Metadata> {
  const { slug } = await props.params;
  const page = docsSource.getPage(slug);
  if (!page) notFound();
  const canonical = new URL(documentationPublicPath(page.url, true), siteOrigins()?.docs ?? "https://docs.carecart.xyz").href;
  return { title: `${page.data.title} | CareCart Docs`, description: page.data.description,
    alternates: { canonical },
    openGraph: { title: `${page.data.title} | CareCart Docs`, description: page.data.description, url: canonical, type: "website", siteName: "CareCart Docs" },
    twitter: { card: "summary", title: `${page.data.title} | CareCart Docs`, description: page.data.description },
  };
}
