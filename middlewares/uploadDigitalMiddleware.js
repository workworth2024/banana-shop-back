import multer from 'multer';

const uploadDigital = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }
});

export default uploadDigital;
