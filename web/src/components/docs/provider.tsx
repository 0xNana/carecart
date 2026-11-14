"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { FrameworkProvider, type Framework, type ImageProps } from "fumadocs-core/framework";
import { RootProvider } from "fumadocs-ui/provider/base";
import { documentationPublicPath } from "@/lib/application-routing";

const DocsSubdomain = createContext(false);

function useDocumentationPathname() {
  const subdomain = useContext(DocsSubdomain);
  return documentationPublicPath(usePathname(), subdomain);
}

function DocumentationLink({ href, ...props }: ComponentProps<NonNullable<Framework["Link"]>>) {
  return href ? <Link {...props} href={href} /> : <a {...props} />;
}

function DocumentationImage({ src, alt, width, height, ...props }: ImageProps) {
  if (!src) throw new Error("Documentation images require a source");
  return <Image {...props} src={src} alt={alt ?? ""} width={width === undefined ? undefined : Number(width)} height={height === undefined ? undefined : Number(height)} />;
}

/** Keep the prerendered /docs path and rewritten browser path identical for Fumadocs. */
export function DocumentationProvider({ children, subdomain }: { children: ReactNode; subdomain: boolean }) {
  return (
    <DocsSubdomain value={subdomain}>
      <FrameworkProvider Link={DocumentationLink} Image={DocumentationImage} useRouter={useRouter} useParams={useParams} usePathname={useDocumentationPathname}>
        <RootProvider theme={{ enabled: false }} search={{ options: { api: subdomain ? "/api/search" : "/docs-search" } }}>
          {children}
        </RootProvider>
      </FrameworkProvider>
    </DocsSubdomain>
  );
}
