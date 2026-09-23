import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bunnyDelete, extractBunnyPath, isBunnyPath } from './bunnyStorage.js';

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

export function deleteAnyFile(urlOrPath) {
  if (!urlOrPath || typeof urlOrPath !== 'string') return;
  if (urlOrPath.startsWith('/uploads/')) {
    const rel = urlOrPath.replace(/^\/uploads\//, '');
    const abs = path.join(UPLOADS_ROOT, rel);
    if (fs.existsSync(abs)) {
      try { fs.unlinkSync(abs); } catch {}
    } else {
      const cdnPath = urlOrPath.replace(/^\/uploads/, '');
      bunnyDelete(cdnPath).catch(() => {});
    }
    return;
  }
  if (isBunnyPath(urlOrPath)) {
    bunnyDelete(urlOrPath).catch(() => {});
    return;
  }
  const bunnyPath = extractBunnyPath(urlOrPath);
  if (bunnyPath) {
    bunnyDelete(bunnyPath).catch(() => {});
  }
}

/** Pulls out image URLs embedded in a rich-text HTML body (e.g. inserted via
 * ArticleEditor's image button) so they can be cleaned up when the article is
 * edited or removed. `folder` is the storage folder the images were uploaded
 * into (matches the remotePath used by the relevant upload*File() helper —
 * 'manuals' for manuals, 'partners' for partners, etc). */
export function extractImageUrls(content = '', folder = 'manuals') {
  const escapedFolder = folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const localMatches = content.match(new RegExp(`/uploads/${escapedFolder}/[^\\s"'<>)]+`, 'g')) || [];
  const cdnBase = (process.env.BUNNY_CDN_URL || '').replace(/\/$/, '');
  let cdnMatches = [];
  if (cdnBase) {
    const escapedBase = cdnBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escapedBase}/${escapedFolder}/[^\\s"'<>)]+`, 'g');
    cdnMatches = content.match(re) || [];
  }
  return [...new Set([...localMatches, ...cdnMatches])];
}
