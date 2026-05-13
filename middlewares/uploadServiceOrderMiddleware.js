import multer from 'multer';

const uploadServiceOrder = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }
});

export default uploadServiceOrder;
