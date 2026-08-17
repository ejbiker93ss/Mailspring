import * as OnboardingActions from '../lib/onboarding-actions';
import TutorialPage from '../lib/page-tutorial';

describe('TutorialPage', () => {
  it('continues directly to account selection', () => {
    spyOn(OnboardingActions, 'moveToPage');

    const page = new TutorialPage({});
    page.setState = ((nextState) => {
      page.state = { ...page.state, ...nextState };
    }) as typeof page.setState;

    page._onNextUnseen();
    page._onNextUnseen();
    page._onNextUnseen();

    expect(OnboardingActions.moveToPage).toHaveBeenCalledWith('account-choose');
    expect(OnboardingActions.moveToPage).not.toHaveBeenCalledWith('authenticate');
  });
});
