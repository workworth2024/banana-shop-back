import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(UPLOADS_ROOT);
ensureDir(path.join(UPLOADS_ROOT, 'manuals'));
ensureDir(path.join(UPLOADS_ROOT, 'reviews'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let dir = UPLOADS_ROOT;
    if (req.originalUrl.includes('/manuals')) {
      dir = path.join(UPLOADS_ROOT, 'manuals');
    } else if (req.originalUrl.includes('/reviews')) {
      dir = path.join(UPLOADS_ROOT, 'reviews');
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (req.originalUrl.includes('/manuals')) {
      return cb(null, true);
    }
    const filetypes = /jpeg|jpg|png|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only images (jpg, png, webp) are allowed'));
  }
});

export default upload;
