import { mkdirSync } from 'fs';
import { join, dirname, isAbsolute, resolve, normalize, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = dirname(dirname(__dirname));
export const DEFAULT_SCREENSHOT_DIR = join(PROJECT_ROOT, 'screenshots');

// Relative paths are resolved against PROJECT_ROOT and must stay inside it —
// `../foo` and `..\..\windows` would otherwise resolve outside the project.
// Absolute paths are accepted as-is: callers passing one are explicitly
// opting out of the project-root sandbox (e.g., a temp dir for batch runs).
export function resolveScreenshotDir(output_dir) {
  if (!output_dir) {
    mkdirSync(DEFAULT_SCREENSHOT_DIR, { recursive: true });
    return DEFAULT_SCREENSHOT_DIR;
  }
  const dir = isAbsolute(output_dir)
    ? normalize(output_dir)
    : resolve(PROJECT_ROOT, output_dir);
  if (!isAbsolute(output_dir)) {
    const rootWithSep = PROJECT_ROOT.endsWith(sep) ? PROJECT_ROOT : PROJECT_ROOT + sep;
    if (dir !== PROJECT_ROOT && !dir.startsWith(rootWithSep)) {
      throw new Error(`output_dir "${output_dir}" escapes the project root. Use an absolute path or a relative path inside ${PROJECT_ROOT}.`);
    }
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}
