import type { MetadataRoute } from 'next';
import { siteOrigins } from '@/lib/application-routing';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/app', '/login', '/signup', '/onboarding', '/auth/'] },
    sitemap: (siteOrigins()?.docs ?? 'https://docs.carecart.xyz') + '/sitemap.xml',
  };
}
