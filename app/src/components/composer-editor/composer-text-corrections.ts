import { Editor, Node, Text } from 'slate';

interface ComposerDiffSegment {
  type: 'same' | 'added' | 'removed';
  text: string;
}

function diffTokens(value: string) {
  return value.match(/\s+|[A-Za-z0-9_']+|[^A-Za-z0-9_'\s]/g) || [];
}

// Lists and tables contain nested blocks. Keep each paragraph/list item as its
// own text line without replacing any of the surrounding formatting nodes.
function editableTextBlocks(editor: Editor, nodes: Node[]) {
  const blocks: Node[] = [];
  const visit = (node: Node) => {
    if (node.object === 'text' || editor.query('isVoid', node)) return;
    if (node.object === 'block' && !node.nodes.some((child) => child.object === 'block')) {
      blocks.push(node);
    } else {
      node.nodes.forEach(visit);
    }
  };
  nodes.forEach(visit);
  return blocks;
}

export function editableTextForWritingCheck(editor: Editor, nodes: Node[]) {
  return editableTextBlocks(editor, nodes)
    .map((node) => node.text.replace(/\u00a0/g, ' '))
    .join('\n');
}

export function buildComposerWordDiff(before: string, after: string): ComposerDiffSegment[] {
  const left = diffTokens(before);
  const right = diffTokens(after);
  if (left.length * right.length > 2_000_000) {
    return [
      { type: 'removed', text: before },
      { type: 'added', text: after },
    ];
  }
  const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i][j] =
        left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const raw: ComposerDiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      raw.push({ type: 'same', text: left[i++] });
      j++;
    } else if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) {
      raw.push({ type: 'added', text: right[j++] });
    } else {
      raw.push({ type: 'removed', text: left[i++] });
    }
  }
  return raw.reduce<ComposerDiffSegment[]>((segments, segment) => {
    const previous = segments[segments.length - 1];
    if (previous?.type === segment.type) previous.text += segment.text;
    else segments.push({ ...segment });
    return segments;
  }, []);
}

// Apply only text operations. Deleting a Slate range also deletes any images,
// links and other inline nodes within it, even when their text is empty.
export function applyEditableTextCorrections(editor: Editor, nodes: Node[], corrected: string) {
  const normalize = (text: string) => text.replace(/\u00a0/g, ' ');
  const blocks = editableTextBlocks(editor, nodes);
  const original = editableTextForWritingCheck(editor, nodes);
  const fullText =
    original.match(/^\s*/)[0] + corrected.replace(/\r\n/g, '\n').trim() + original.match(/\s*$/)[0];
  const lines = fullText.split('\n');
  if (lines.length !== original.split('\n').length) {
    throw new Error(
      'The writing check changed paragraph breaks. Review these corrections manually.'
    );
  }

  const operations: (() => void)[] = [];
  let line = 0;
  for (const node of blocks) {
    const count = node.text.split('\n').length;
    const replacement = lines.slice(line, line + count).join('\n');
    line += count;
    if (normalize(node.text) === replacement) continue;
    // The review preview can show a whole-text fallback for very large diffs,
    // but applying that fallback would erase formatting across text runs.
    if (diffTokens(node.text).length * diffTokens(replacement).length > 2_000_000)
      throw new Error('The corrections are too extensive to apply safely. Review them manually.');
    const runs: { node: Text; start: number; end: number }[] = [];
    let offset = 0;
    const collect = (current: Node) => {
      if (current.object === 'text') {
        runs.push({ node: current as Text, start: offset, end: offset + current.text.length });
        offset += current.text.length;
      } else if (!editor.query('isVoid', current)) {
        current.nodes.forEach(collect);
      }
    };
    collect(node);
    if (offset !== node.text.length)
      throw new Error('The draft contains protected text. Review corrections manually.');

    let position = 0;
    const edits: { start: number; length: number; text: string }[] = [];
    let edit: { start: number; length: number; text: string } = null;
    for (const part of buildComposerWordDiff(normalize(node.text), replacement)) {
      if (part.type === 'same') {
        edit = null;
        position += part.text.length;
      } else {
        if (!edit) {
          edit = { start: position, length: 0, text: '' };
          edits.push(edit);
        }
        if (part.type === 'removed') {
          edit.length += part.text.length;
          position += part.text.length;
        } else edit.text += part.text;
      }
    }
    for (const change of edits.reverse()) {
      const anchor =
        runs.find((run) => run.start <= change.start && run.end > change.start) ||
        runs[runs.length - 1];
      if (!anchor) throw new Error('No editable text was found for the corrections.');
      const marks = anchor.node
        .getMarksAtIndex(
          Math.min(change.start - anchor.start, Math.max(0, anchor.node.text.length - 1))
        )
        .toArray();
      operations.push(() => {
        for (const run of [...runs].reverse()) {
          const start = Math.max(run.start, change.start);
          const end = Math.min(run.end, change.start + change.length);
          if (end > start) editor.removeTextByKey(run.node.key, start - run.start, end - start);
        }
        if (change.text)
          editor.insertTextByKey(anchor.node.key, change.start - anchor.start, change.text, marks);
      });
    }
  }
  editor.withoutNormalizing(() => operations.forEach((apply) => apply()));
}
