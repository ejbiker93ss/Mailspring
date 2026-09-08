import { normalizeOutlookAccounts, OutlookAccount } from '../../../src/outlook-import';

export const pendingOutlookKey = 'pendingOutlookAccounts';

export function pendingOutlookAccounts() {
  return normalizeOutlookAccounts(AppEnv.config.get(pendingOutlookKey));
}

export function savePendingOutlookAccounts(accounts: OutlookAccount[]) {
  AppEnv.config.set(pendingOutlookKey, normalizeOutlookAccounts(accounts));
}

export function removePendingOutlookAccount(email: string) {
  savePendingOutlookAccounts(
    pendingOutlookAccounts().filter((account) => account.emailAddress !== email.toLowerCase())
  );
}
