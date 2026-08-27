import fs from 'fs';
import path from 'path';

type ThemeRecoveryConfig = {
  set(keyPath: string, value: string): boolean;
};

type ThemeRecoveryFileSystem = Pick<typeof fs, 'rmSync'>;

export const SAFE_THEME_SETTINGS = [
  ['core.theme', 'ui-automatic'],
  ['core.appearance.lightThemeName', 'ui-light'],
  ['core.appearance.darkThemeName', 'ui-dark'],
] as const;

export function themeCompileCachePaths(configDirPath: string) {
  const compileCacheRoot = path.join(configDirPath, 'compile-cache');
  return [path.join(compileCacheRoot, 'less'), path.join(compileCacheRoot, 'less-rtl')];
}

export function resetThemeForRecovery(
  config: ThemeRecoveryConfig,
  configDirPath: string,
  fileSystem: ThemeRecoveryFileSystem = fs
) {
  for (const [keyPath, value] of SAFE_THEME_SETTINGS) {
    if (!config.set(keyPath, value)) {
      throw new Error(`Could not reset theme setting: ${keyPath}`);
    }
  }

  const cacheClearErrors: Error[] = [];
  for (const cachePath of themeCompileCachePaths(configDirPath)) {
    try {
      fileSystem.rmSync(cachePath, { recursive: true, force: true });
    } catch (error) {
      cacheClearErrors.push(error);
    }
  }
  return cacheClearErrors;
}
