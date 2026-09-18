import { Category } from './category';
import { localized } from '../../intl';

export class Folder extends Category {
  get displayName() {
    const name = super.displayName;
    // SmarterMail's scheduled-send folder has an account-specific hex ID.
    // Alias only the label; the original path is still required by the server.
    return /^Scheduled[0-9a-f]{31,32}$/i.test(name) ? localized('Scheduled') : name;
  }

  displayType() {
    return 'folder';
  }
}
