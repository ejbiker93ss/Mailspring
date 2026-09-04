import React from 'react';
import { Actions, localized } from 'summermail-exports';

function SyncingListState(props: { empty?: boolean }) {
  let message = localized('Looking for more messages');
  if (props.empty) {
    message = localized('Loading Messages');
  }
  return (
    <div className="syncing-list-state" style={{ width: '100%', textAlign: 'center' }}>
      {message}&hellip;
      <br />
      <a onClick={Actions.expandSyncState}>{localized('Show Progress')}</a>
    </div>
  );
}

export default SyncingListState;
