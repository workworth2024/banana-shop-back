import Preorder from '../models/Preorder.js';
import GoogleAdsProduct from '../models/GoogleAdsProduct.js';

export const createPreorder = async (req, res) => {
  try {
    const { google_item_id, name, telegram, desired_quantity, comment } = req.body;
    if (!google_item_id || !name || !telegram || !desired_quantity) {
      return res.status(400).json({ message: 'Обязательные поля: google_item_id, name, telegram, desired_quantity' });
    }
    const product = await GoogleAdsProduct.findById(google_item_id);
    if (!product) return res.status(404).json({ message: 'Товар не найден' });

    const preorder = await Preorder.create({
      google_item_id,
      name,
      telegram,
      desired_quantity: parseInt(desired_quantity),
      comment: comment || ''
    });
    res.status(201).json(preorder);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Error creating preorder' });
  }
};

export const getPreorders = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', status = '', startDate, endDate } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { telegram: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) query.status = status;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const skip = (page - 1) * limit;
    const preorders = await Preorder.find(query)
      .populate('google_item_id', 'title')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Preorder.countDocuments(query);
    res.json({ preorders, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching preorders' });
  }
};

export const updatePreorderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['pending', 'canceled', 'completed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const preorder = await Preorder.findByIdAndUpdate(id, { status }, { new: true })
      .populate('google_item_id', 'title');
    if (!preorder) return res.status(404).json({ message: 'Preorder not found' });
    res.json(preorder);
  } catch (error) {
    res.status(500).json({ message: 'Error updating preorder' });
  }
};

export const deletePreorder = async (req, res) => {
  try {
    await Preorder.findByIdAndDelete(req.params.id);
    res.json({ message: 'Preorder deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting preorder' });
  }
};
