import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface AppSettings {
  orchestrationGlobalMaxSubtasks: number | null;
}

const DEFAULT_SETTINGS: AppSettings = {
  orchestrationGlobalMaxSubtasks: null,
};

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function normalizeCap(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : null;
}

function normalizeSettings(input: unknown): AppSettings {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    orchestrationGlobalMaxSubtasks: normalizeCap(raw.orchestrationGlobalMaxSubtasks),
  };
}

export function getAppSettings(): AppSettings {
  const settingsPath = getSettingsPath();
  try {
    if (!fs.existsSync(settingsPath)) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return normalizeSettings(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveAppSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getAppSettings();
  const merged = normalizeSettings({ ...current, ...patch });
  const settingsPath = getSettingsPath();

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n');

  return merged;
}
