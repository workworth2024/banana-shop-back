import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.resolve(__dirname, '..', 'uploads');

export function deleteUploadFile(urlPath) {
  if (!urlPath || !urlPath.startsWith('/uploads/')) return;
  const rel = urlPath.replace(/^\/uploads\//, '');
  const abs = path.join(UPLOADS_ROOT, rel);
  if (fs.existsSync(abs)) {
    try { fs.unlinkSync(abs); } catch {}
  }
}

export function extractImageUrls(content = '') {
  const matches = content.match(/\/uploads\/manuals\/[^\s"'<>)]+/g) || [];
  return [...new Set(matches)];
}
