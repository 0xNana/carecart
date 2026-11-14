import defaultMdxComponents from "fumadocs-ui/mdx";
import { Card, type CardProps } from "fumadocs-ui/components/card";
import Link from "fumadocs-core/link";
import type { ComponentProps } from "react";
import type { MDXComponents } from "mdx/types";
import { documentationPublicPath, siteOrigins } from "@/lib/application-routing";

function href(path: string | undefined) {
  return path ? documentationPublicPath(path, !!siteOrigins()) : path;
}
function DocsLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} href={href(props.href)} />;
}
function DocsCard(props: CardProps) {
  return <Card {...props} href={href(props.href)} />;
}
export function getMDXComponents(): MDXComponents {
  return { ...defaultMdxComponents, a: DocsLink, Card: DocsCard };
}
