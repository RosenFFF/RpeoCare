import { notFound } from 'next/navigation';
import { docChapters } from '@/features/product-docs/catalog';
import { DocumentPage } from '@/features/product-docs/document-page';

export const dynamicParams = false;
export function generateStaticParams() { return docChapters.filter(item => item.slug).map(item => ({ slug: item.slug })); }

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const chapter = docChapters.find(item => item.slug === slug);
  if (!chapter) notFound();
  return { title: `${chapter.title} · RepoCare 产品文档`, description: chapter.description };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  return <DocumentPage slug={slug} />;
}
