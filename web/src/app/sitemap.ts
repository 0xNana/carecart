import type { MetadataRoute } from 'next';
import { docsSource } from '@/lib/docs-source';
import { documentationPublicPath, siteOrigins } from '@/lib/application-routing';

export default function sitemap(): MetadataRoute.Sitemap {
  const origins = siteOrigins();
  return [
    { url: origins?.site ?? 'https://carecart.xyz' },
    ...docsSource.getPages().map(page => ({
      url: new URL(documentationPublicPath(page.url, true), origins?.docs ?? 'https://docs.carecart.xyz').href,
    })),
  ];
}
