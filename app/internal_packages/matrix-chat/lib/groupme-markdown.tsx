import React from 'react';

interface Props {
  text: string;
  renderText?: (text: string, offset: number) => React.ReactNode;
}

type TableCell = { text: string; offset: number };
type TableAlignment = 'left' | 'center' | 'right' | undefined;

function tableCells(line: { text: string; offset: number }): TableCell[] | null {
  const pipeIndexes: number[] = [];
  for (let i = 0; i < line.text.length; i++) {
    if (line.text[i] === '|' && (i === 0 || line.text[i - 1] !== '\\')) pipeIndexes.push(i);
  }
  if (!pipeIndexes.length) return null;

  const startsWithPipe = /^\s*\|/.test(line.text);
  const endsWithPipe = /\|\s*$/.test(line.text);
  const boundaries = [...pipeIndexes];
  if (!startsWithPipe) boundaries.unshift(-1);
  if (!endsWithPipe) boundaries.push(line.text.length);

  const cells: TableCell[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const rawStart = boundaries[i] + 1;
    const rawEnd = boundaries[i + 1];
    const raw = line.text.slice(rawStart, rawEnd);
    const leadingSpace = raw.length - raw.trimStart().length;
    cells.push({ text: raw.trim(), offset: line.offset + rawStart + leadingSpace });
  }
  return cells;
}

function tableAlignments(cells: TableCell[]): TableAlignment[] | null {
  const alignments: TableAlignment[] = [];
  for (const cell of cells) {
    const marker = cell.text.replace(/\s/g, '');
    if (!/^:?-{3,}:?$/.test(marker)) return null;
    alignments.push(
      marker.startsWith(':') && marker.endsWith(':')
        ? 'center'
        : marker.endsWith(':')
          ? 'right'
          : marker.startsWith(':')
            ? 'left'
            : undefined
    );
  }
  return alignments;
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
    const headerCells = tableCells(line);
    const dividerCells = lines[i + 1] ? tableCells(lines[i + 1]) : null;
    const alignments = dividerCells ? tableAlignments(dividerCells) : null;
    if (
      headerCells &&
      alignments &&
      headerCells.length === alignments.length &&
      headerCells.length > 1
    ) {
      const rows: TableCell[][] = [];
      i += 2;
      while (i < lines.length) {
        const cells = tableCells(lines[i]);
        if (!cells || cells.length !== headerCells.length) break;
        rows.push(cells);
        i++;
      }
      i--;
      blocks.push(
        <div className="groupme-markdown-table-wrap" key={line.offset}>
          <table>
            <thead>
              <tr>
                {headerCells.map((cell, index) => (
                  <th key={cell.offset} style={{ textAlign: alignments[index] }}>
                    {inline(cell.text, cell.offset)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((cells, rowIndex) => (
                <tr key={cells[0]?.offset ?? `${line.offset}-${rowIndex}`}>
                  {cells.map((cell, index) => (
                    <td key={cell.offset} style={{ textAlign: alignments[index] }}>
                      {inline(cell.text, cell.offset)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    const listPattern = /^(\s*(?:[-+*]|\d+\.)\s+)(.*)$/;
    const list = listPattern.exec(line.text);
    if (list) {
      const ordered = /^\s*\d/.test(line.text);
      const items: React.ReactNode[] = [];
      do {
        const current = lines[i];
        const match = listPattern.exec(current.text);
        if (!match) break;
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
