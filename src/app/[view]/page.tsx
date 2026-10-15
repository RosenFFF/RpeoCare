import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/workspace/workspace";
import { isView } from "@/shared/lib/navigation";

export default async function ViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (view === "agent") redirect("/overview");
  if (!isView(view)) notFound();
  return <Workspace view={view} />;
}
