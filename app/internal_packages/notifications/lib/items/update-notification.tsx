import { localized, React } from 'summermail-exports';
import { ipcRenderer, shell } from 'electron';
import { Notification } from 'summermail-component-kit';
import { Disposable } from 'event-kit';

interface UpdateNotificationState {
  updateAvailable: boolean;
  version: string;
  updateIsManual: boolean;
}

export default class UpdateNotification extends React.Component<
  Record<string, unknown>,
  UpdateNotificationState
> {
  static displayName = 'UpdateNotification';

  disposable?: Disposable;

  constructor(props) {
    super(props);
    this.state = this.getStateFromStores();
  }

  componentDidMount() {
    this.disposable = AppEnv.onUpdateAvailable(() => {
      this.setState(this.getStateFromStores());
    });
  }

  componentWillUnmount() {
    this.disposable.dispose();
  }

  getStateFromStores() {
    const updater = require('@electron/remote').getGlobal('application').autoUpdateManager;
    const updateAvailable = updater.getState() === 'update-available';
    const info = updateAvailable ? updater.getReleaseDetails() : {};
    return {
      updateAvailable,
      updateIsManual: info.releaseNotes === 'manual-download',
      version: info.releaseVersion,
    };
  }

  _onUpdate = () => {
    ipcRenderer.send('command', 'application:install-update');
  };

  _onViewChangelog = () => {
    if (process.env.SUMMERMAIL_CHANGELOG_URL) {
      shell.openExternal(process.env.SUMMERMAIL_CHANGELOG_URL);
    }
  };

  render() {
    const { updateAvailable, version, updateIsManual } = this.state;

    if (!updateAvailable) {
      return <span />;
    }
    return (
      <Notification
        priority="4"
        title={localized(
          `An update to SummerMail is available %@`,
          version ? `(${version.replace(/(?:SummerMail|Mailspring)/, '').trim()})` : ''
        )}
        subtitle={localized('View changelog')}
        subtitleAction={this._onViewChangelog}
        icon="volstead-upgrade.png"
        actions={[
          {
            label: updateIsManual ? localized('Download Now') : localized('Install'),
            fn: this._onUpdate,
          },
        ]}
        isDismissable
      />
    );
  }
}
