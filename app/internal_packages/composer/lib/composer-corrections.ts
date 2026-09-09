export interface CorrectionPart {
  before: string;
  after: string;
  changed: boolean;
}

export function correctionParts(segments: { type: string; text: string }[]): CorrectionPart[] {
  const parts: CorrectionPart[] = [];
  for (const segment of segments) {
    if (segment.type === 'same') {
      parts.push({ before: segment.text, after: segment.text, changed: false });
    } else {
      let part = parts[parts.length - 1];
      if (!part?.changed) {
        part = { before: '', after: '', changed: true };
        parts.push(part);
      }
      if (segment.type === 'removed') part.before += segment.text;
      if (segment.type === 'added') part.after += segment.text;
    }
  }
  return parts;
}

export function applySelectedCorrections(parts: CorrectionPart[], excluded: Set<number>) {
  return parts
    .map((part, index) => (part.changed && !excluded.has(index) ? part.after : part.before))
    .join('');
}
