import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREORDER_DIR = path.join(__dirname, '..', 'uploads', 'preorders');

if (!fs.existsSync(PREORDER_DIR)) {
  fs.mkdirSync(PREORDER_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PREORDER_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    cb(null, `${ts}-${base}${ext}`);
  }
});

const uploadPreorder = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

export default uploadPreorder;
