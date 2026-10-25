import { uniqueId } from './catalog';

type Node = { type: string; value?: string; depth?: number; children?: Node[]; data?: { hName?: string; hProperties?: Record<string, unknown> } };

export const calloutKinds = { NOTE: 'note', TIP: 'tip', IMPORTANT: 'important', WARNING: 'warning', CAUTION: 'caution' } as const;
export type CalloutKind = typeof calloutKinds[keyof typeof calloutKinds];

function text(node: Node): string { return node.value ?? (node.children ?? []).map(text).join(''); }

/**
 * Adds stable ids to H2/H3 headings (matching the page outline) and turns GitHub-style
 * alerts (`> [!NOTE]`) into callout asides, so the same Markdown also reads well on GitHub.
 */
export function remarkDocs() {
  return (tree: Node) => {
    const used = new Map<string, number>();
    const visit = (node: Node) => {
      if (node.type === 'heading' && (node.depth === 2 || node.depth === 3)) {
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: uniqueId(text(node).trim(), used) } };
      }
      if (node.type === 'blockquote') markCallout(node);
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function markCallout(node: Node) {
  const first = node.children?.[0];
  const lead = first?.type === 'paragraph' ? first.children?.[0] : undefined;
  const match = lead?.type === 'text' ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][^\S\n]*\n?/.exec(lead.value ?? '') : null;
  if (!first || !lead || !match) return;
  lead.value = (lead.value ?? '').slice(match[0].length);
  if (!lead.value) first.children?.shift();
  if (first.children?.[0]?.type === 'break') first.children.shift();
  if (!first.children?.length) node.children?.shift();
  const kind = calloutKinds[match[1] as keyof typeof calloutKinds];
  node.data = { hName: 'aside', hProperties: { className: ['pd-callout', `is-${kind}`], 'data-callout': kind } };
}
