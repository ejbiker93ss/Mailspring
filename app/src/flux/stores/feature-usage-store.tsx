import Rx from 'rx-lite';
import MailspringStore from 'mailspring-store';
import * as Actions from '../actions';
import { IdentityStore, EMPTY_FEATURE_USAGE, IIdentity } from './identity-store';
import { SendFeatureUsageEventTask } from '../tasks/send-feature-usage-event-task';

class NoProAccessError extends Error {}

const UsageRecordedServerSide = ['contact-profiles', 'translation'];

export interface FeatureLexicon {
  headerText: string;
  rechargeText: string;
  iconUrl: string;
}

/**
 * FeatureUsageStore is backed by the IdentityStore
 *
 * The billing site is responsible for returning with the Identity object
 * a usage hash that includes all supported features, their quotas for the
 * user, and the current usage of that user. We keep a cache locally
 *
 * The final schema looks like (Feb 7, 2017):
 *
 * MailspringID = {
 *   ...
 *   "featureUsage": {
 *     "snooze": {
 *       "quota": 15,
 *       "period": "monthly",
 *       "usedInPeriod": 10,
 *       "featureLimitName": "snooze-experiment-A",
 *     },
 *     "send-later": {
 *       "quota": 99999,
 *       "period": "unlimited",
 *       "usedInPeriod": 228,
 *       "featureLimitName": "send-later-unlimited-A",
 *     },
 *     "reminders": {
 *       "quota": 10,
 *       "period": "daily",
 *       "usedInPeriod": 10,
 *       "featureLimitName": null,
 *     },
 *   },
 *   ...
 * }
 *
 * Valid periods are:
 * 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'unlimited'
 */
class _FeatureUsageStore extends MailspringStore {
  NoProAccessError = NoProAccessError;
  _disp: Rx.Disposable;

  constructor() {
    super();

    /**
     * The IdentityStore triggers both after we update it, and when it
     * polls for new data every several minutes or so.
     */
    this._disp = Rx.Observable.fromStore(IdentityStore).subscribe(() => {
      this.trigger();
    });
  }

  deactivate() {
    this._disp.dispose();
  }

  displayUpgradeModal(_feature: string, _lexicon: FeatureLexicon) {
    // Retain the public API for older packages, but never interrupt the user
    // with a subscription prompt in this distribution.
    return Promise.resolve();
  }

  isUsable(_feature: string) {
    return true;
  }

  async markUsedOrUpgrade(feature: string, lexicon: FeatureLexicon) {
    void lexicon;
    this.markUsed(feature);
  }

  markUsed(feature: string) {
    const next: IIdentity = JSON.parse(JSON.stringify(IdentityStore.identity()));
    if (!next || !next.featureUsage) return;

    if (next.featureUsage[feature]) {
      next.featureUsage[feature].usedInPeriod += 1;
      IdentityStore.saveIdentity(next);
    }
    if (!UsageRecordedServerSide.includes(feature)) {
      Actions.queueTask(new SendFeatureUsageEventTask({ feature }));
    }
  }

  _dataForFeature(feature: string) {
    const identity = IdentityStore.identity();
    if (!identity) {
      return EMPTY_FEATURE_USAGE;
    }

    const usage = identity.featureUsage || {};
    if (!usage[feature]) {
      // Feature not yet in server identity (expected during new-feature rollout). Do
      // not report to Sentry — this is a transient state, not an application error.
      console.warn(
        `FeatureUsageStore: no usage data for feature "${feature}", defaulting to allowed`
      );
      return EMPTY_FEATURE_USAGE;
    }
    return usage[feature];
  }
}

export const FeatureUsageStore = new _FeatureUsageStore();
