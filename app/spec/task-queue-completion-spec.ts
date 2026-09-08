import TaskQueue from '../src/flux/stores/task-queue';
import { Task } from '../src/flux/tasks/task';

const draftTask = (status: string) => Object.assign(new Task({ status }), { id: 'draft-save' });

describe('TaskQueue completion latency', () => {
  let saved;
  let trigger: jasmine.Spy;

  beforeEach(() => {
    saved = {
      _queue: TaskQueue._queue,
      _completed: TaskQueue._completed,
      _waitingForLocal: TaskQueue._waitingForLocal,
      _waitingForRemote: TaskQueue._waitingForRemote,
    };
    TaskQueue._queue = [];
    TaskQueue._completed = [];
    TaskQueue._waitingForLocal = [];
    TaskQueue._waitingForRemote = [];
    TaskQueue._triggerQueueChanged.cancel();
    trigger = spyOn(TaskQueue, 'trigger');
  });

  afterEach(() => {
    TaskQueue._triggerQueueChanged.cancel();
    Object.assign(TaskQueue, saved);
  });

  it('acknowledges a local save during the UI throttle window', () => {
    const pending = draftTask(Task.Status.Local);
    const savedTask = draftTask(Task.Status.Remote);
    const resolve = jasmine.createSpy('resolve');
    TaskQueue._onQueueChanged([pending]);
    TaskQueue._waitingForLocal.push({ task: pending, resolve });

    TaskQueue._onQueueChanged([savedTask]);

    expect(resolve).toHaveBeenCalledWith(savedTask);
    expect(TaskQueue.queue()).toEqual([savedTask]);
    expect(TaskQueue._waitingForLocal.length).toBe(0);
    expect(trigger.callCount).toBe(1);
  });

  it('does not acknowledge a draft before the local save completes', () => {
    const pending = draftTask(Task.Status.Local);
    const resolve = jasmine.createSpy('resolve');
    TaskQueue._waitingForLocal.push({ task: pending, resolve });
    TaskQueue._onQueueChanged([pending]);
    expect(resolve).not.toHaveBeenCalled();
    expect(TaskQueue._waitingForLocal.length).toBe(1);
  });

  it('acknowledges remote completion without waiting for a UI refresh', () => {
    const pending = draftTask(Task.Status.Remote);
    const completed = draftTask(Task.Status.Complete);
    const resolve = jasmine.createSpy('resolve');
    TaskQueue._onQueueChanged([pending]);
    TaskQueue._waitingForRemote.push({ task: pending, resolve });
    TaskQueue._onQueueChanged([completed]);
    expect(resolve).toHaveBeenCalledWith(completed);
    expect(TaskQueue.completed()).toEqual([completed]);
    expect(trigger.callCount).toBe(1);
  });
});
