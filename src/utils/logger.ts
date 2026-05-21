import { env } from '@/config/env';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): number {
  const l = env.runtime.logLevel.toLowerCase() as Level;
  return LEVELS[l] ?? LEVELS.info;
}

function emit(level: Level, message: string, data?: Record<string, unknown>): void {
  if (LEVELS[level] < currentLevel()) return;
  const stamp = new Date().toISOString();
  const base = `[${stamp}] [${level.toUpperCase()}] ${message}`;
  if (data && Object.keys(data).length > 0) {
    // eslint-disable-next-line no-console
    console.log(base, JSON.stringify(data));
  } else {
    // eslint-disable-next-line no-console
    console.log(base);
  }
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => emit('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => emit('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => emit('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit('error', msg, data),
  child(scope: string) {
    return {
      debug: (msg: string, data?: Record<string, unknown>) => emit('debug', `[${scope}] ${msg}`, data),
      info: (msg: string, data?: Record<string, unknown>) => emit('info', `[${scope}] ${msg}`, data),
      warn: (msg: string, data?: Record<string, unknown>) => emit('warn', `[${scope}] ${msg}`, data),
      error: (msg: string, data?: Record<string, unknown>) => emit('error', `[${scope}] ${msg}`, data),
    };
  },
};
