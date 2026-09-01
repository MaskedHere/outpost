import crypto from 'node:crypto';
import type { UnresolvedEntry } from '../modrinth/import.js';

// A tiny in-memory job tracker so a slow CurseForge import (resolve → download a possibly
// 100-200MB file → match hundreds of mods against Modrinth) can report real progress instead of
// leaving the frontend staring at one opaque, minutes-long request. Deliberately not persisted —
// an import job that outlives a backend restart isn't meaningful to resume anyway.
export type ImportJobStatus =
  | { phase: 'resolving' }
  | { phase: 'downloading'; current: number; total: number }
  | { phase: 'matching'; current: number; total: number }
  | { phase: 'done'; pack: unknown; format: string; unresolved: UnresolvedEntry[]; clientOnly: UnresolvedEntry[] }
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
