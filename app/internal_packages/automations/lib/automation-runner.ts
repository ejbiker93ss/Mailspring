import { Actions, AutomationActionRegistry, FocusedContentStore, Thread } from 'summermail-exports';
import AutomationStore from './automation-store';
import { Automation, AutomationRunResult } from './automation-types';
import ThreadListStore from '../../thread-list/lib/thread-list-store';
import { recordAutomationRun } from './automation-run-history';

const activeRuns = new Set<string>();

function runKey(automationId: string, threads: Thread[]) {
  return `${automationId}:${threads
    .map((thread) => thread.id)
    .sort()
    .join(',')}`;
}

class AutomationRunner {
  async run(id: string, suppliedThreads: Thread[] = []): Promise<AutomationRunResult> {
    const automation = AutomationStore.automation(id);
    if (!automation || !AutomationStore.canRun(automation)) {
      return { automationId: id, status: 'skipped', error: 'This automation is unavailable.' };
    }
    const threads = this._targets(suppliedThreads);
    if (!threads.length) {
      (AppEnv as any).showToast?.({ message: 'Select a conversation first.' });
      return { automationId: id, status: 'skipped', error: 'No conversation selected.' };
    }

    const key = runKey(id, threads);
    if (activeRuns.has(key)) return { automationId: id, status: 'skipped' };
    activeRuns.add(key);
    const startedAt = new Date().toISOString();
    const frozen = JSON.parse(JSON.stringify(automation)) as Automation;
    try {
      for (let stepIndex = 0; stepIndex < frozen.steps.length; stepIndex++) {
        const step = frozen.steps[stepIndex];
        const action = AutomationActionRegistry.action(step.type);
        if (!action) throw new Error(`Step ${stepIndex + 1} is no longer available.`);
        const errors = action.validate(step.config);
        if (errors.length) throw new Error(`Step ${stepIndex + 1}: ${errors[0]}`);

        // A step is a barrier: every target finishes before the next action can
        // send, print, move, or remove anything.
        for (const thread of threads) {
          await action.execute({ automation: frozen, step, stepIndex, thread }, step.config);
        }
      }
      (AppEnv as any).showToast?.({ message: `Finished ${frozen.name}.` });
      recordAutomationRun({
        automationId: id,
        automationName: frozen.name,
        status: 'complete',
        startedAt,
        finishedAt: new Date().toISOString(),
        targetCount: threads.length,
      });
      return { automationId: id, status: 'complete' };
    } catch (error) {
      const message = error?.message || 'The automation could not finish.';
      AppEnv.showErrorDialog({ title: `${automation.name} stopped`, message });
      recordAutomationRun({
        automationId: id,
        automationName: frozen.name,
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        targetCount: threads.length,
        error: message.slice(0, 500),
      });
      return { automationId: id, status: 'failed', error: message };
    } finally {
      activeRuns.delete(key);
    }
  }

  private _targets(supplied: Thread[]) {
    const selected = (ThreadListStore.dataSource()?.selection?.items?.() || []) as Thread[];
    const targets = supplied?.length
      ? supplied
      : selected.length
        ? selected
        : [FocusedContentStore.focused('thread') as Thread];
    const seen = new Set<string>();
    return targets.filter((thread) => thread && !seen.has(thread.id) && !!seen.add(thread.id));
  }
}

const runner = new AutomationRunner();
Actions.runAutomation.listen((id: string, threads?: Thread[]) => runner.run(id, threads));
export default runner;
