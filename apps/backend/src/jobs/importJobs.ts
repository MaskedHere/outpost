import crypto from 'node:crypto';
import type { UnresolvedEntry } from '../modrinth/import.js';

// In-memory job tracker so slow CurseForge imports can report progress instead of blocking on one
// long request. Not persisted; jobs don't need to survive a restart.
export type ImportJobStatus =
  | { phase: 'resolving' }
  | { phase: 'downloading'; current: number; total: number }
  | { phase: 'matching'; current: number; total: number }
  | {
      phase: 'done';
      pack: unknown;
      format: string;
      unresolved: UnresolvedEntry[];
      clientOnly: UnresolvedEntry[];
    }
  | { phase: 'error'; error: string };

const jobs = new Map<string, ImportJobStatus>();
const JOB_TTL_MS = 10 * 60 * 1000;

export function createImportJob(): string {
  const id = crypto.randomUUID();
  jobs.set(id, { phase: 'resolving' });
  setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
  return id;
}

export function updateImportJob(id: string, status: ImportJobStatus): void {
  jobs.set(id, status);
}

export function getImportJob(id: string): ImportJobStatus | undefined {
  return jobs.get(id);
}
