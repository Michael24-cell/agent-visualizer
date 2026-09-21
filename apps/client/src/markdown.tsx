import { Fragment, type ReactNode } from 'react';

// Enough markdown for agent replies: fenced code, headings, bullet and
// numbered lists, paragraphs, inline code, bold and italics. Renders to
// React nodes; no HTML is ever injected.

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { kind: 'code'; language: string; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'paragraph'; text: string };

function blocks(source: string): Block[] {
  const out: Block[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const fence = /^```\s*(\w+)?\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index]!)) {
        body.push(lines[index]!);
        index += 1;
      }
      index += 1;
      out.push({
        kind: 'code',
        language: fence[1] ?? '',
        text: body.join('\n'),
      });
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      out.push({
        kind: 'heading',
        level: heading[1]!.length,
        text: heading[2]!,
      });
      index += 1;
      continue;
    }
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length && bullet.test(lines[index]!)) {
        items.push(lines[index]!.replace(bullet, ''));
        index += 1;
      }
      out.push({ kind: 'list', ordered, items });
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index]!.trim() !== '' &&
      !bullet.test(lines[index]!) &&
      !/^```/.test(lines[index]!) &&
      !/^#{1,4}\s/.test(lines[index]!)
    ) {
      paragraph.push(lines[index]!);
      index += 1;
    }
    out.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  return (
    <>
      {blocks(text).map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case 'code':
            return (
              <pre key={key} className="md-code" data-language={block.language}>
                <code>{block.text}</code>
              </pre>
            );
          case 'heading':
            return (
              <p key={key} className={`md-heading md-h${block.level}`}>
                {inline(block.text, key)}
              </p>
            );
          case 'list': {
            const items = block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>
                {inline(item, `${key}-${itemIndex}`)}
              </li>
            ));
            return block.ordered ? (
              <ol key={key} className="md-list">
                {items}
              </ol>
            ) : (
              <ul key={key} className="md-list">
                {items}
              </ul>
            );
          }
          default:
            return (
              <p key={key}>
                {block.text.split('\n').map((line, lineIndex, all) => (
                  <Fragment key={`${key}-${lineIndex}`}>
                    {inline(line, `${key}-${lineIndex}`)}
                    {lineIndex < all.length - 1 ? <br /> : null}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </>
  );
}
