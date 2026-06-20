import { validateModelConfig, type ModelConfig } from '../theme/models';

/** Parses uploaded file content -> config or error (twin of parseUploadedMapping). */
export function parseUploadedModelConfig(text: string):
  | { ok: true; config: ModelConfig }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  return validateModelConfig(parsed);
}

/** Downloads config as model-config.json (DOM-only; no-op without document). */
export function downloadModelConfig(models: ModelConfig): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([JSON.stringify(models, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'model-config.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
