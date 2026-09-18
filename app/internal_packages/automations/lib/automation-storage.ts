import fs from 'fs';
import path from 'path';
import { Automation, AutomationFile } from './automation-types';

const EMPTY: AutomationFile = { schemaVersion: 1, automations: [] };

export default class AutomationStorage {
  private filePath = path.join(AppEnv.getConfigDirPath(), 'automations.json');

  load(): Automation[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as AutomationFile;
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.automations)) {
        throw new Error('Unsupported automation file format.');
      }
      return parsed.automations.filter(
        (item) => item && item.id && item.name && Array.isArray(item.steps)
      );
    } catch (error) {
      const backup = `${this.filePath}.invalid-${Date.now()}`;
      try {
        if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, backup);
      } catch (_) {
        // Keep the original error actionable even if the backup cannot be written.
      }
      AppEnv.showErrorDialog({
        title: 'Could not load automations',
        message:
          'Your automation file was left unchanged. Create or restore automations after reviewing the error.',
        detail: error.message,
      });
      return [];
    }
  }

  save(automations: Automation[]) {
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    const data = JSON.stringify({ ...EMPTY, automations }, null, 2);
    fs.writeFileSync(tempPath, data, 'utf8');
    fs.renameSync(tempPath, this.filePath);
  }
}
