/* eslint global-require: 0*/
import React from 'react';
import fs from 'fs';
import { localized } from 'mailspring-exports';
import ConfigSchemaItem from './config-schema-item';
import WorkspaceSection from './workspace-section';
import SendingSection from './sending-section';
import LanguageSection from './language-section';
import { ConfigLike, ConfigSchemaLike } from '../types';
import { createSettingsBundle, sanitizedSettings, settingsFromBundle } from '../settings-transfer';

class PreferencesGeneral extends React.Component<{
  config: ConfigLike;
  configSchema: ConfigSchemaLike;
}> {
  static displayName = 'PreferencesGeneral';

  _onReboot = () => {
    console.log('general relaunch');
    const app = require('@electron/remote').app;
    app.relaunch();
    app.quit();
  };

  _onResetEmailsThatIgnoreWarnings = () => {
    localStorage.removeItem('recipientWarningBlacklist');
  };

  _onResetAccountsAndSettings = () => {
    const chosen = require('@electron/remote').dialog.showMessageBoxSync({
      type: 'info',
      message: localized('Are you sure?'),
      buttons: [localized('Cancel'), localized('Reset')],
    });

    if (chosen === 1) {
      fs.rm(AppEnv.getConfigDirPath(), { recursive: true, force: true }, (err) => {
        if (err) {
          return AppEnv.showErrorDialog(
            localized(
              `Could not reset accounts and settings. Please delete the folder %@ manually.\n\n%@`,
              AppEnv.getConfigDirPath(),
              err.toString()
            )
          );
        }
        this._onReboot();
      });
    }
  };

  _onResetEmailCache = () => {
    const ipc = require('electron').ipcRenderer;
    ipc.send('command', 'application:reset-database', {});
  };

  _onExportSettings = () => {
    AppEnv.showSaveDialog(
      {
        title: localized('Export Settings'),
        buttonLabel: localized('Export'),
        defaultPath: 'flashmail-settings.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      },
      (filePath: string) => {
        if (!filePath) return;
        try {
          const rawSettings = (AppEnv.config as any).getRawValues();
          const bundle = createSettingsBundle(rawSettings);
          fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8');
          require('@electron/remote').dialog.showMessageBoxSync({
            type: 'info',
            message: localized('Settings exported successfully.'),
            detail: localized(
              'Account credentials and security tokens are intentionally not included.'
            ),
            buttons: [localized('OK')],
          });
        } catch (err) {
          AppEnv.showErrorDialog(localized('Could not export settings.\n\n%@', err.toString()));
        }
      }
    );
  };

  _onImportSettings = () => {
    AppEnv.showOpenDialog(
      {
        title: localized('Import Settings'),
        buttonLabel: localized('Import'),
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      },
      (selected: string[]) => {
        if (!selected || !selected[0]) return;
        try {
          const bundle = JSON.parse(fs.readFileSync(selected[0], 'utf8'));
          const current = (AppEnv.config as any).getRawValues();
          const next = settingsFromBundle(bundle, current);
          const importedRoots = new Set(Object.keys(sanitizedSettings(bundle.settings)));
          if (Array.isArray(bundle.folderPreferences)) {
            importedRoots.add('core');
            importedRoots.add('mail-kanban');
          }
          (AppEnv.config as any).transact(() => {
            importedRoots.forEach((key) => AppEnv.config.set(key, next[key]));
          });
          require('@electron/remote').dialog.showMessageBoxSync({
            type: 'info',
            message: localized('Settings imported successfully.'),
            detail: localized(
              'Favorite folders and Kanban lanes were matched to the folders on this device.'
            ),
            buttons: [localized('OK')],
          });
        } catch (err) {
          AppEnv.showErrorDialog(localized('Could not import settings.\n\n%@', err.toString()));
        }
      }
    );
  };

  render() {
    return (
      <div className="container-general">
        <div className="two-columns-flexbox">
          <div style={{ flex: 1 }}>
            <WorkspaceSection config={this.props.config} configSchema={this.props.configSchema} />
            <LanguageSection config={this.props.config} configSchema={this.props.configSchema} />
          </div>
          <div style={{ width: 30 }} />
          <div style={{ flex: 1 }}>
            <ConfigSchemaItem
              configSchema={this.props.configSchema.properties.reading}
              keyName={localized('Reading')}
              keyPath="core.reading"
              config={this.props.config}
            />
          </div>
        </div>
        <div className="two-columns-flexbox" style={{ paddingTop: 30 }}>
          <div style={{ flex: 1 }}>
            <SendingSection config={this.props.config} configSchema={this.props.configSchema} />
            <div
              className="btn"
              onClick={this._onResetEmailsThatIgnoreWarnings}
              style={{ marginLeft: 0, marginTop: 5 }}
            >
              {localized('Reset Emails that Ignore Warnings')}
            </div>
          </div>
          <div style={{ width: 30 }} />
          <div style={{ flex: 1 }}>
            <ConfigSchemaItem
              configSchema={this.props.configSchema.properties.composing}
              keyName={localized('Composing')}
              keyPath="core.composing"
              config={this.props.config}
            />
          </div>
        </div>

        <div className="two-columns-flexbox" style={{ paddingTop: 30 }}>
          <div style={{ flex: 1 }}>
            <ConfigSchemaItem
              configSchema={this.props.configSchema.properties.notifications}
              keyName={localized('Notifications')}
              keyPath="core.notifications"
              config={this.props.config}
            />
          </div>
          <div style={{ width: 30 }} />
          <div style={{ flex: 1 }}>
            <ConfigSchemaItem
              configSchema={this.props.configSchema.properties.attachments}
              keyName={localized('Attachments')}
              keyPath="core.attachments"
              config={this.props.config}
            />
          </div>
        </div>

        <div className="local-data">
          <h6>{localized('Local Data')}</h6>
          <p>
            {localized(
              'Export or import application preferences, including favorite folders and Kanban lanes. Account credentials and security tokens are never exported.'
            )}
          </p>
          <div className="btn" onClick={this._onExportSettings} style={{ marginLeft: 0 }}>
            {localized('Export Settings')}
          </div>
          <div className="btn" onClick={this._onImportSettings}>
            {localized('Import Settings')}
          </div>
          <div style={{ height: 12 }} />
          <div className="btn" onClick={this._onResetEmailCache} style={{ marginLeft: 0 }}>
            {localized('Reset Cache')}
          </div>
          <div className="btn" onClick={this._onResetAccountsAndSettings}>
            {localized('Reset Accounts and Settings')}
          </div>
        </div>
      </div>
    );
  }
}

export default PreferencesGeneral;
