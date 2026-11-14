import { LandingPage } from "@/components/landing-page";

import {siteOrigins} from '@/lib/application-routing';

export default function Home() {
  return <LandingPage appOrigin={siteOrigins()?.app} docsOrigin={siteOrigins()?.docs} />;
}
