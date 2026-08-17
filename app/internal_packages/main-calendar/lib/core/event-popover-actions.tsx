import React from 'react';
import { localized } from 'mailspring-exports';

interface EventPopoverActionsProps {
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  saveDisabled?: boolean;
  saveLabel?: string;
}

export const EventPopoverActions: React.FC<EventPopoverActionsProps> = ({
  onSave,
  onCancel,
  onDelete,
  saveDisabled = false,
  saveLabel,
}) => {
  return (
    <div className="event-popover-actions">
      {onDelete && (
        <button className="btn event-delete-button" onClick={onDelete}>
          {localized('Delete')}
        </button>
      )}
      <button className="btn" onClick={onCancel}>
        {localized('Cancel')}
      </button>
      <button className="btn btn-emphasis" onClick={onSave} disabled={saveDisabled}>
        {saveLabel || localized('Save')}
      </button>
    </div>
  );
};
