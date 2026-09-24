import React from 'react';
import { localized } from 'summermail-exports';
import {
  connectMicrosoftTeams,
  disconnectMicrosoftTeams,
  getMicrosoftTeamsConnection,
  MicrosoftTeamsConnection,
} from '../../../main-calendar/lib/core/microsoft-teams-connection';

interface State {
  connection: MicrosoftTeamsConnection | null;
  connecting: boolean;
  status: string;
}

export default class PreferencesMeetingAccounts extends React.Component<
  Record<string, never>,
  State
> {
  state: State = {
    connection: getMicrosoftTeamsConnection(),
    connecting: false,
    status: '',
  };

  _connect = async () => {
    this.setState({ connecting: true, status: localized('Waiting for Microsoft…') });
    try {
      const connection = await connectMicrosoftTeams();
      this.setState({
        connection,
        connecting: false,
        status: localized('Microsoft Teams connected.'),
      });
    } catch (error) {
      this.setState({
        connecting: false,
        status: error.message || String(error),
      });
    }
  };

  _disconnect = async () => {
    await disconnectMicrosoftTeams();
    this.setState({
      connection: null,
      status: localized('Microsoft Teams disconnected.'),
    });
  };

  render() {
    const { connection, connecting, status } = this.state;
    return (
      <section className="meeting-accounts-settings" aria-labelledby="meeting-accounts-heading">
        <div className="meeting-accounts-copy">
          <h5 id="meeting-accounts-heading">{localized('Meeting accounts')}</h5>
          <p>
            {localized(
              'Connect Microsoft to add Teams links, dial-in details, and invitees when you create an event. This meeting connection does not add another mailbox to SummerMail.'
            )}
          </p>
        </div>
        {connection ? (
          <div className="meeting-account-row">
            <div className="meeting-account-identity">
              <span className="meeting-account-provider">{localized('Microsoft Teams')}</span>
              <strong>{connection.name}</strong>
              <small>{connection.emailAddress}</small>
            </div>
            <button className="btn" onClick={this._disconnect}>
              {localized('Disconnect')}
            </button>
          </div>
        ) : (
          <button className="btn btn-emphasis" disabled={connecting} onClick={this._connect}>
            {connecting ? localized('Connecting…') : localized('Connect Microsoft Teams')}
          </button>
        )}
        {status && (
          <p className="meeting-account-status" role="status">
            {status}
          </p>
        )}
      </section>
    );
  }
}
