import { siteOrigins } from "./application-routing";
import { loader } from "fumadocs-core/source";
import { docs } from "../../.source/server";

export const docsSource = loader({
  baseUrl: siteOrigins() ? "/" : "/docs",
  source: docs.toFumadocsSource(),
});
