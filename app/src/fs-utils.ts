import fs from 'fs';
import * as Utils from './flux/models/utils';

export function atomicWriteFileSync(filepath: string, content: string) {
  const randomId = Utils.generateTempId();
  const backupPath = `${filepath}.${randomId}.bak`;
  fs.writeFileSync(backupPath, content);
  try {
    fs.renameSync(backupPath, filepath);
  } catch (renameError) {
    // Windows can reject an otherwise-valid atomic replacement while the
    // destination is being scanned or briefly held open. The temporary file
    // has already been written successfully, so fall back to replacing the
    // contents in place and remove the temporary copy only after that works.
    // Keep the original error behavior on other platforms and for a missing
    // destination, where rename should remain the atomic path.
    if (process.platform !== 'win32' || !fs.existsSync(filepath)) {
      throw renameError;
    }
    fs.copyFileSync(backupPath, filepath);
    fs.unlinkSync(backupPath);
  }
}
