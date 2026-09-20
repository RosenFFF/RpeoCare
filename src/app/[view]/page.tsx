import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { isView } from "@/lib/navigation";

export default async function ViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!isView(view)) notFound();
  return <Workspace view={view} />;
}
