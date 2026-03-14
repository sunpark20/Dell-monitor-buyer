import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PriceCheckResult, CONFIG } from '../types.js';

export async function loadHistory(): Promise<PriceCheckResult[]> {
  try {
    const raw = await readFile(CONFIG.HISTORY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveHistory(history: PriceCheckResult[]): Promise<void> {
  // 365일(~1460건) 초과 시 오래된 데이터 정리
  const trimmed = history.length > CONFIG.MAX_HISTORY_ENTRIES
    ? history.slice(-CONFIG.MAX_HISTORY_ENTRIES)
    : history;

  await mkdir(dirname(CONFIG.HISTORY_FILE), { recursive: true });
  await writeFile(CONFIG.HISTORY_FILE, JSON.stringify(trimmed, null, 2) + '\n');
}

export function getLastResult(history: PriceCheckResult[]): PriceCheckResult | null {
  return history.length > 0 ? history[history.length - 1] : null;
}
