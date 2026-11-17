import React from 'react';
import { Contact } from '../flux/models/contact';
import * as Utils from '../flux/models/utils';

// Initials on a color derived from the address, so a sender keeps the same
// color in every list. Used when no avatar plugin supplies a picture.
export function SenderInitials({ contact }: { contact: Contact }) {
  const hue = Utils.hueForString(contact.email);
  return (
    <span
      className="sender-initials"
      style={{ backgroundColor: `hsl(${hue}, 45%, 42%)` }}
      aria-hidden="true"
    >
      {contact.nameAbbreviation() || '?'}
    </span>
  );
}
