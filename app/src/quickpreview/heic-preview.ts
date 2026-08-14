import fs from 'fs';
import { nativeImage } from 'electron';

const convertHeic = require('heic-convert');

const HEIC_EXTENSIONS = new Set(['heic', 'heif']);
const conversionsInFlight = new Map<string, Promise<string>>();

export function isHeicExtension(extension = '') {
  return HEIC_EXTENSIONS.has(extension.toLowerCase().replace(/^\./, ''));
}

export function isHeicFilePath(filePath: string) {
  const extension = filePath.slice(filePath.lastIndexOf('.') + 1);
  return isHeicExtension(extension);
}

async function existingPreviewIsCurrent(sourcePath: string, previewPath: string) {
  try {
    const [sourceStats, previewStats] = await Promise.all([
      fs.promises.stat(sourcePath),
      fs.promises.stat(previewPath),
    ]);
    return previewStats.size > 0 && previewStats.mtimeMs >= sourceStats.mtimeMs;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Decode a HEIC/HEIF file into a browser-compatible PNG without modifying the
 * source attachment. Calls for the same output are coalesced because the inline
 * viewer and thumbnail generator commonly request it at the same time.
 */
export async function ensureHeicPreview(
  sourcePath: string,
  previewPath = `${sourcePath}.preview.png`,
  { maxDimension }: { maxDimension?: number } = {}
): Promise<string> {
  if (await existingPreviewIsCurrent(sourcePath, previewPath)) return previewPath;

  const existingConversion = conversionsInFlight.get(previewPath);
  if (existingConversion) return existingConversion;

  const conversion = (async () => {
    const temporaryPath = `${previewPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      const source = await fs.promises.readFile(sourcePath);
      const converted = Buffer.from(await convertHeic({ buffer: source, format: 'PNG' }));
      let png = converted;

      if (maxDimension) {
        const image = nativeImage.createFromBuffer(converted);
        if (image.isEmpty()) throw new Error('The decoded HEIC image was empty.');
        const { width, height } = image.getSize();
        if (Math.max(width, height) > maxDimension) {
          const size = width >= height ? { width: maxDimension } : { height: maxDimension };
          png = image.resize({ ...size, quality: 'good' }).toPNG();
        }
      }

      await fs.promises.writeFile(temporaryPath, png);

      // The destination is derived cache data. Only replace it after the new
      // preview has been decoded and completely written.
      await fs.promises.unlink(previewPath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
      await fs.promises.rename(temporaryPath, previewPath);
      return previewPath;
    } finally {
      await fs.promises.unlink(temporaryPath).catch(() => {});
    }
  })();

  conversionsInFlight.set(previewPath, conversion);
  try {
    return await conversion;
  } finally {
    conversionsInFlight.delete(previewPath);
  }
}
