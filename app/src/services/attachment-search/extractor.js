const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 200000;
const MAX_PAGES = 100;
const MAX_SHEET_ROWS = 10000;
const MAX_SHEET_COLUMNS = 200;
const VERSION = 1;
const TEXT_EXTENSIONS = new Set(['txt', 'csv', 'md', 'log', 'json', 'xml']);
const SHEET_EXTENSIONS = new Set(['xlsx', 'xls', 'ods']);

function supported(extension) {
  return (
    extension === 'pdf' ||
    extension === 'docx' ||
    TEXT_EXTENSIONS.has(extension) ||
    SHEET_EXTENSIONS.has(extension)
  );
}

async function extract(filePath, extension) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { status: 'too-large', text: '' };
  if (!supported(extension)) return { status: 'unsupported', text: '' };
  // Bound reads even if a download grows after stat().
  const chunks = [];
  let length = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    length += chunk.length;
    if (length > MAX_FILE_BYTES) return { status: 'too-large', text: '' };
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, length);
  let text = '';
  let partial = false;
  if (TEXT_EXTENSIONS.has(extension)) {
    text =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? bytes.subarray(2).toString('utf16le')
        : bytes.toString('utf8');
  } else if (extension === 'docx') {
    const result = await require('mammoth').extractRawText(
      { buffer: bytes },
      { externalFileAccess: false }
    );
    text = result.value;
  } else if (SHEET_EXTENSIONS.has(extension)) {
    const XLSX = require('../../quickpreview/xlsx-0.18.5/xlsx.full.min.js');
    const book = XLSX.read(bytes, {
      type: 'buffer',
      sheetRows: MAX_SHEET_ROWS,
      bookVBA: false,
      cellHTML: false,
    });
    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name];
      if (!sheet['!ref']) continue;
      const range = XLSX.utils.decode_range(sheet['!ref']);
      partial ||= !!sheet['!fullref'] || range.e.c >= MAX_SHEET_COLUMNS;
      range.e.c = Math.min(range.e.c, MAX_SHEET_COLUMNS - 1);
      range.e.r = Math.min(range.e.r, MAX_SHEET_ROWS - 1);
      if (range.s.c > range.e.c || range.s.r > range.e.r) continue;
      text += `\n${name}\n`;
      // This bundled SheetJS version reads !ref, not a range option. Limit
      // each row explicitly and stop as soon as the text budget is exhausted.
      for (let row = range.s.r; row <= range.e.r; row++) {
        sheet['!ref'] = XLSX.utils.encode_range({
          s: { r: row, c: range.s.c },
          e: { r: row, c: range.e.c },
        });
        text += `${XLSX.utils.sheet_to_csv(sheet)}\n`;
        if (text.length >= MAX_TEXT_CHARS) break;
      }
      if (text.length >= MAX_TEXT_CHARS) {
        partial = true;
        break;
      }
    }
  } else {
    const root = path
      .join(__dirname, '../../quickpreview/pdfjs-4.3.136')
      .replace('app.asar', 'app.asar.unpacked');
    const pdfjs = await import(pathToFileURL(path.join(root, 'build/pdf.mjs')).href);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      path.join(root, 'build/pdf.worker.mjs')
    ).href;
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
      cMapUrl: `${path.join(root, 'web/cmaps')}${path.sep}`,
      cMapPacked: true,
    });
    try {
      const document = await task.promise;
      partial = document.numPages > MAX_PAGES;
      for (let number = 1; number <= Math.min(document.numPages, MAX_PAGES); number++) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => item.str || '').join(' ');
        // No OCR runs here. Mixed scanned/text documents are marked partial.
        if (!pageText.trim()) partial = true;
        text += `\n${pageText}`;
        page.cleanup();
        if (text.length >= MAX_TEXT_CHARS) {
          partial = true;
          break;
        }
      }
    } finally {
      await task.destroy();
    }
  }
  partial ||= text.length > MAX_TEXT_CHARS;
  text = text
    .slice(0, MAX_TEXT_CHARS)
    .normalize('NFKC')
    .replaceAll(String.fromCharCode(0), '')
    .slice(0, MAX_TEXT_CHARS)
    .trim();
  return {
    status: text ? (partial ? 'partial' : 'indexed') : extension === 'pdf' ? 'needs-ocr' : 'empty',
    text,
  };
}

if (require.main === module) {
  try {
    const os = require('os');
    os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch (error) {
    console.warn('Attachment extraction priority unavailable:', error.code);
  }
  process.once('message', async ({ filePath, extension }) => {
    try {
      const result = await extract(filePath, extension);
      process.send(result, () => process.exit(0));
    } catch (error) {
      const status = /password|encrypted/i.test(error.name + ' ' + error.message)
        ? 'encrypted'
        : 'failed';
      process.send({ status, text: '' }, () => process.exit(0));
    }
  });
  process.on('disconnect', () => process.exit(0));
}

module.exports = { extract, supported, MAX_FILE_BYTES, VERSION };
