import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPLACE_DIR = path.join(__dirname, '..', 'uploads', 'replace-requests');

if (!fs.existsSync(REPLACE_DIR)) {
  fs.mkdirSync(REPLACE_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, REPLACE_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${ts}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

const uploadReplace = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Only images (jpg, png, webp) allowed'));
  }
});

export default uploadReplace;
