import multer from 'multer';
import path from 'path';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (req.originalUrl.includes('/manuals')) {
      return cb(null, true);
    }
    const filetypes = /jpeg|jpg|png|webp/;
    const extOk = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = filetypes.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Only images (jpg, png, webp) are allowed'));
  }
});

export default upload;
