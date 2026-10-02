import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Set while an automation rule is changing a task. Events raised from inside it are ignored by
 * the automation engine, so one rule can never trigger another (or itself): no loops, no cascades.
 */
export const automationContext = new AsyncLocalStorage<{ ruleId: string }>();
