import { buildSearchIndex } from '@/features/product-docs/doc-source';

// The manual only changes with a deployment, so the index is generated once at build time.
export const dynamic = 'force-static';

export function GET() {
  return Response.json(buildSearchIndex(), { headers: { 'Cache-Control': 'public, max-age=300' } });
}
