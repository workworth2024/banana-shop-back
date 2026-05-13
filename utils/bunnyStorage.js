import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import * as BunnyStorageSDK from '@bunny.net/storage-sdk';

let _publicZone = null;
let _privateZone = null;

const connectZone = (storageZoneName, accessKey) =>
  BunnyStorageSDK.zone.connect_with_accesskey(
    BunnyStorageSDK.regions.StorageRegion.Falkenstein,
    storageZoneName,
    accessKey
  );

export const publicZone = () => {
  if (!_publicZone) {
    const name = process.env.BUNNY_STORAGE_ZONE;
    const key = process.env.BUNNY_ACCESS_KEY;
    if (!name || !key) {
      throw new Error('BUNNY_STORAGE_ZONE and BUNNY_ACCESS_KEY are required');
    }
    _publicZone = connectZone(name, key);
  }
  return _publicZone;
};

export const privateZone = () => {
  if (!_privateZone) {
    const name = process.env.BUNNY_PRIVATE_STORAGE_ZONE;
    const key = process.env.BUNNY_PRIVATE_ACCESS_KEY;
    if (!name || !key) {
      throw new Error('BUNNY_PRIVATE_STORAGE_ZONE and BUNNY_PRIVATE_ACCESS_KEY are required');
    }
    _privateZone = connectZone(name, key);
  }
  return _privateZone;
};

/** Публичное CDN-хранилище: /replacement-proofs/ (ссылку отдаём в CRM). Приватное: /digital-items/, legacy /replace-requests/, и т.д. */
const zoneForRemotePath = (remotePath) => {
  if (!remotePath || typeof remotePath !== 'string') return publicZone();
  return isBunnyPath(remotePath) ? privateZone() : publicZone();
};

export const generateFilename = (originalname) => {
  const ext = path.extname(originalname);
  const base = path.basename(originalname, ext)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
  return `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${base}${ext}`;
};

export const getBunnyPublicUrl = (remotePath) => {
  const cdnUrl = (process.env.BUNNY_CDN_URL || '').replace(/\/$/, '');
  return `${cdnUrl}${remotePath}`;
};

export const extractBunnyPath = (fullUrl) => {
  const cdnUrl = (process.env.BUNNY_CDN_URL || '').replace(/\/$/, '');
  if (cdnUrl && typeof fullUrl === 'string' && fullUrl.startsWith(cdnUrl)) {
    return fullUrl.slice(cdnUrl.length);
  }
  return null;
};

export const isBunnyPath = (p) => {
  if (!p || typeof p !== 'string') return false;
  return (
    p.startsWith('/digital-items/') ||
    p.startsWith('/replace-requests/') ||
    p.startsWith('/service-orders/') ||
    p.startsWith('/preorders/')
  );
};

export const isBunnyCdnUrl = (p) => {
  const cdnUrl = (process.env.BUNNY_CDN_URL || '').replace(/\/$/, '');
  return Boolean(cdnUrl && typeof p === 'string' && p.startsWith(cdnUrl));
};

export const bunnyUpload = async (remotePath, data, contentType) => {
  const opts = contentType ? { contentType } : undefined;
  await BunnyStorageSDK.file.upload(zoneForRemotePath(remotePath), remotePath, data, opts);
};

export const bunnyDelete = async (remotePath) => {
  try {
    await BunnyStorageSDK.file.remove(zoneForRemotePath(remotePath), remotePath);
  } catch {}
};

export const bunnyDownload = async (remotePath) => {
  const result = await BunnyStorageSDK.file.download(zoneForRemotePath(remotePath), remotePath);
  return { stream: Readable.fromWeb(result.stream), length: result.length };
};
