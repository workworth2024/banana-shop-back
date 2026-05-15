import multer from 'multer';
import path from 'path';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain'
]);

const ALLOWED_EXT = /\.(jpe?g|png|webp|gif|pdf|txt)$/i;

const uploadSupport = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const extOk = ALLOWED_EXT.test(path.extname(file.originalname));
    const mimeOk = ALLOWED_MIME.has(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Allowed: jpg, png, webp, gif, pdf, txt (max 5MB)'));
  }
});

export default uploadSupport;
