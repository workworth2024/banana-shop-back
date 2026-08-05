import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Preorder from '../models/Preorder.js';
import ServiceOrder from '../models/ServiceOrder.js';
import { escapeRegex } from '../utils/safeQuery.js';

const ORDER_NORMALIZE = [
  {
    $addFields: {
      type: 'order',
      displayTitle: '$productSnapshot.title',
      displayAmount: '$amount',
      displayStatus: '$status',
      displayQuantity: '$quantity',
      totalQty: '$quantity'
    }
  }
];

const PREORDER_NORMALIZE = [
  { $lookup: { from: 'googleadsproducts', localField: 'google_item_id', foreignField: '_id', as: '_googleProduct' } },
  { $lookup: { from: 'youtubeproducts', localField: 'youtube_item_id', foreignField: '_id', as: '_youtubeProduct' } },
  {
    $addFields: {
      type: 'preorder',
      displayTitle: {
        $ifNull: [
          { $arrayElemAt: ['$_googleProduct.title.ru', 0] },
          {
            $ifNull: [
              { $arrayElemAt: ['$_youtubeProduct.title.ru', 0] },
              {
                $ifNull: [
                  { $arrayElemAt: ['$_googleProduct.title.en', 0] },
                  { $arrayElemAt: ['$_youtubeProduct.title.en', 0] }
                ]
              }
            ]
          }
        ]
      },
      displayAmount: '$amountPaid',
      displayStatus: '$status',
      displayQuantity: '$desired_quantity',
      totalQty: '$desired_quantity'
    }
  },
  { $project: { _googleProduct: 0, _youtubeProduct: 0 } }
];

const SERVICE_NORMALIZE = [
  {
    $addFields: {
      type: 'service_order',
      displayTitle: '$serviceSnapshot.title',
      displayAmount: '$amountPaid',
      displayStatus: '$status',
      displayQuantity: 1,
      totalQty: 1
    }
  }
];

function buildUnionPipeline(type) {
  if (type === 'order') return { Model: Order, pipeline: [...ORDER_NORMALIZE] };
  if (type === 'preorder') return { Model: Preorder, pipeline: [...PREORDER_NORMALIZE] };
  if (type === 'service_order') return { Model: ServiceOrder, pipeline: [...SERVICE_NORMALIZE] };

  return {
    Model: Order,
    pipeline: [
      ...ORDER_NORMALIZE,
      { $unionWith: { coll: Preorder.collection.name, pipeline: PREORDER_NORMALIZE } },
      { $unionWith: { coll: ServiceOrder.collection.name, pipeline: SERVICE_NORMALIZE } }
    ]
  };
}

export const getOrderHistory = async (req, res) => {
  try {
    const {
      page = 1, limit = 20, type = '', status = '', customerId = '',
      productTitle = '', search = '', startDate, endDate
    } = req.query;

    const pg = Math.min(10000, Math.max(1, parseInt(page) || 1));
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 20));
    const skip = (pg - 1) * lim;

    const { Model, pipeline: unionPipeline } = buildUnionPipeline(type);

    const matchStage = {};
    if (status) matchStage.displayStatus = status;
    if (customerId && mongoose.Types.ObjectId.isValid(customerId)) {
      matchStage.customerId = new mongoose.Types.ObjectId(customerId);
    }
    if (productTitle) {
      matchStage.displayTitle = { $regex: escapeRegex(String(productTitle).slice(0, 200)), $options: 'i' };
    }
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = end;
      }
    }
    if (search) {
      const safe = escapeRegex(String(search).slice(0, 100));
      matchStage.$or = [
        { uid: { $regex: safe, $options: 'i' } },
        { displayTitle: { $regex: safe, $options: 'i' } },
        { 'customer.username': { $regex: safe, $options: 'i' } }
      ];
    }

    const pipeline = [
      ...unionPipeline,
      { $lookup: { from: 'customerusers', localField: 'customerId', foreignField: '_id', as: 'customer' } },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      { $match: matchStage },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: lim }],
          totalCount: [{ $count: 'count' }]
        }
      }
    ];

    const result = await Model.aggregate(pipeline);
    const data = result[0]?.data || [];
    const total = result[0]?.totalCount?.[0]?.count || 0;

    return res.status(200).json({
      history: data,
      total,
      pages: Math.ceil(total / lim),
      currentPage: pg
    });
  } catch (error) {
    console.error('[OrderHistory] getOrderHistory error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getOrderHistoryFilters = async (req, res) => {
  try {
    const pipeline = [
      ...ORDER_NORMALIZE,
      { $unionWith: { coll: Preorder.collection.name, pipeline: PREORDER_NORMALIZE } },
      { $unionWith: { coll: ServiceOrder.collection.name, pipeline: SERVICE_NORMALIZE } },
      { $match: { displayTitle: { $nin: [null, ''] } } },
      { $group: { _id: '$displayTitle' } },
      { $sort: { _id: 1 } },
      { $limit: 500 }
    ];

    const rows = await Order.aggregate(pipeline);
    return res.status(200).json({ titles: rows.map(r => r._id).filter(Boolean) });
  } catch (error) {
    console.error('[OrderHistory] getOrderHistoryFilters error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
