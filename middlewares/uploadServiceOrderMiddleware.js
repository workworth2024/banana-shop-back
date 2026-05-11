import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_ORDER_DIR = path.join(__dirname, '..', 'uploads', 'service-orders');

if (!fs.existsSync(SERVICE_ORDER_DIR)) {
  fs.mkdirSync(SERVICE_ORDER_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, SERVICE_ORDER_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    cb(null, `${ts}-${base}${ext}`);
  }
});

const uploadServiceOrder = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

export default uploadServiceOrder;
