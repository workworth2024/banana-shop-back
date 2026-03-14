import Review from '../models/Review.js';

export const getReviews = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { 'text.ru': { $regex: search, $options: 'i' } },
        { 'text.en': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    const reviews = await Review.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Review.countDocuments(query);

    res.json({ reviews, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching reviews' });
  }
};

export const createReview = async (req, res) => {
  try {
    const text = {
      ru: req.body?.['text.ru'] || '',
      en: req.body?.['text.en'] || ''
    };
    const link = req.body?.link || '';
    const image = req.file ? `/uploads/reviews/${req.file.filename}` : '';

    const review = await Review.create({ text, link, image });
    res.status(201).json(review);
  } catch (error) {
    console.error('createReview error:', error.message, error.stack);
    res.status(500).json({ message: error.message || 'Error creating review' });
  }
};

export const updateReview = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {
      link: req.body?.link || '',
      text: {
        ru: req.body?.['text.ru'] || '',
        en: req.body?.['text.en'] || ''
      }
    };

    if (req.file) {
      updateData.image = `/uploads/reviews/${req.file.filename}`;
    }

    const review = await Review.findByIdAndUpdate(id, updateData, { new: true });
    res.json(review);
  } catch (error) {
    console.error('updateReview error:', error.message, error.stack);
    res.status(500).json({ message: error.message || 'Error updating review' });
  }
};

export const deleteReview = async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ message: 'Review deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting review' });
  }
};
