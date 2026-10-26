import express from 'express';
import {
  publicListBlogPosts, publicGetBlogPostBySlug, publicGetBlogRss, publicGetBlogSitemapEntries,
  publicRegisterBlogView, publicReactToBlogPost
} from '../../controllers/blogController.js';

const router = express.Router();

const verifyPublicToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1]?.trim();
  const envToken = process.env.API_KEY?.trim();
  if (!token || !envToken || token !== envToken) {
    return res.status(401).json({ message: 'Unauthorized: Invalid token' });
  }
  next();
};

// RSS is meant to be consumed by feed readers, so it stays open (no Bearer token required).
router.get('/:lang/rss.xml', publicGetBlogRss);
router.get('/sitemap-entries', publicGetBlogSitemapEntries);

router.get('/:lang/posts', verifyPublicToken, publicListBlogPosts);
router.get('/:lang/posts/:slug', verifyPublicToken, publicGetBlogPostBySlug);
router.post('/:lang/posts/:slug/view', verifyPublicToken, publicRegisterBlogView);
router.post('/:lang/posts/:slug/reactions', verifyPublicToken, publicReactToBlogPost);

export default router;
