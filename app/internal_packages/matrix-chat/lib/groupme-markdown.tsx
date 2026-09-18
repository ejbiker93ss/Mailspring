import React from 'react';

interface Props {
  text: string;
  renderText?: (text: string, offset: number) => React.ReactNode;
}

// Render to React nodes, never HTML. Raw HTML remains text and links use a
// protocol allowlist. Original offsets keep GroupMe mentions/emoji aligned.
export default function GroupMeMarkdown({ text, renderText = (value) => value }: Props) {
  function inline(value: string, offset: number, depth = 0): React.ReactNode {
    if (depth > 8) return renderText(value, offset);
    const pattern =
      /(`+)([^`]+)\1|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)|(\*\*|__|~~)(.+?)\5|(\*|_)([^\n]+?)\7/g;
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
      nodes.push(renderText(value.slice(cursor, match.index), offset + cursor));
      const start = offset + match.index;
      if (match[1]) nodes.push(<code key={start}>{match[2]}</code>);
      else if (match[3])
        nodes.push(
          <a key={start} href={match[4]} target="_blank" rel="noopener noreferrer">
            {inline(match[3], start + 1, depth + 1)}
          </a>
        );
      else if (match[5]) {
        const Tag = match[5] === '~~' ? 'del' : 'strong';
        nodes.push(<Tag key={start}>{inline(match[6], start + 2, depth + 1)}</Tag>);
      } else nodes.push(<em key={start}>{inline(match[8], start + 1, depth + 1)}</em>);
      cursor = match.index + match[0].length;
    }
    nodes.push(renderText(value.slice(cursor), offset + cursor));
    return nodes;
  }

  const lines: { text: string; offset: number }[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    lines.push({ text: line.replace(/\r$/, ''), offset });
    offset += line.length + 1;
  }
  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.text.trim()) continue;
    if (/^\s*```/.test(line.text)) {
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i].text)) code.push(lines[i].text);
      blocks.push(
        <pre key={line.offset}>
          <code>{code.join('\n')}</code>
        </pre>
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.text);
    if (heading) {
      blocks.push(
        React.createElement(
          `h${heading[1].length}`,
          { key: line.offset },
          inline(heading[2], line.offset + heading[1].length + 1)
        )
      );
      continue;
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line.text)) {
      blocks.push(<hr key={line.offset} />);
      continue;
    }
    const listPattern = /^(\s*(?:[-+*]|\d+\.)\s+)(.*)$/;
    const list = listPattern.exec(line.text);
    if (list) {
      const ordered = /^\s*\d/.test(line.text);
      const items: React.ReactNode[] = [];
      do {
        const current = lines[i],
          match = listPattern.exec(current.text)!;
        items.push(
          <li key={current.offset}>{inline(match[2], current.offset + match[1].length)}</li>
        );
        if (
          !lines[i + 1] ||
          !listPattern.test(lines[i + 1].text) ||
          /^\s*\d/.test(lines[i + 1].text) !== ordered
        )
          break;
        i++;
      } while (i < lines.length);
      blocks.push(
        ordered ? (
          <ol key={line.offset} start={parseInt(line.text.trim(), 10)}>
            {items}
          </ol>
        ) : (
          <ul key={line.offset}>{items}</ul>
        )
      );
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line.text);
    if (quote)
      blocks.push(
        <blockquote key={line.offset}>
          {inline(quote[1], line.offset + line.text.length - quote[1].length)}
        </blockquote>
      );
    else blocks.push(<p key={line.offset}>{inline(line.text, line.offset)}</p>);
  }
  return <div className="groupme-markdown">{blocks}</div>;
}
