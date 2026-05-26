import CustomerUser from '../models/CustomerUser.js';
import ReferralTransaction from '../models/ReferralTransaction.js';
import ReferralSettings from '../models/ReferralSettings.js';
import CustomerReferralRate from '../models/CustomerReferralRate.js';
import { escapeRegex } from '../utils/safeQuery.js';

async function getOrInitSettings() {
  let s = await ReferralSettings.findOne();
  if (!s) s = await ReferralSettings.create({});
  return s;
}

export const getSettings = async (req, res) => {
  try {
    const settings = await getOrInitSettings();
    return res.json(settings);
  } catch (e) {
    console.error('[Referral] getSettings error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const { googleAds, youtube, services } = req.body;
    const update = {};
    if (googleAds !== undefined) update.googleAds = Math.min(100, Math.max(0, Number(googleAds)));
    if (youtube !== undefined) update.youtube = Math.min(100, Math.max(0, Number(youtube)));
    if (services !== undefined) update.services = Math.min(100, Math.max(0, Number(services)));

    let settings = await ReferralSettings.findOne();
    if (!settings) settings = await ReferralSettings.create(update);
    else {
      Object.assign(settings, update);
      await settings.save();
    }
    return res.json(settings);
  } catch (e) {
    console.error('[Referral] updateSettings error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getMyReferralStats = async (req, res) => {
  try {
    const customerId = req.customer._id;
    const { search = '', period = 'month', page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [user, settings, individualRate] = await Promise.all([
      CustomerUser.findById(customerId).select('referralCode'),
      getOrInitSettings(),
      CustomerReferralRate.findOne({ customerId }).lean()
    ]);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const effectiveRates = {
      googleAds: (individualRate?.googleAds !== null && individualRate?.googleAds !== undefined) ? individualRate.googleAds : settings.googleAds,
      youtube: (individualRate?.youtube !== null && individualRate?.youtube !== undefined) ? individualRate.youtube : settings.youtube,
      services: (individualRate?.services !== null && individualRate?.services !== undefined) ? individualRate.services : settings.services,
      isIndividual: {
        googleAds: individualRate?.googleAds !== null && individualRate?.googleAds !== undefined,
        youtube: individualRate?.youtube !== null && individualRate?.youtube !== undefined,
        services: individualRate?.services !== null && individualRate?.services !== undefined
      }
    };

    const dateFilter = {};
    const now = new Date();
    if (period === 'month') {
      dateFilter.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), 1) };
    } else if (period === 'quarter') {
      const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      dateFilter.createdAt = { $gte: qStart };
    }

    const searchQuery = {};
    if (search.trim()) {
      const safe = escapeRegex(String(search).slice(0, 100));
      const matchingUsers = await CustomerUser.find({
        $or: [
          { username: { $regex: safe, $options: 'i' } },
          { telegramUsername: { $regex: safe, $options: 'i' } },
          { uid: { $regex: safe, $options: 'i' } }
        ]
      }).select('_id');
      searchQuery.referralId = { $in: matchingUsers.map(u => u._id) };
    }

    const [allTime, periodData] = await Promise.all([
      ReferralTransaction.aggregate([
        { $match: { referrerId: customerId, status: 'active' } },
        { $group: { _id: null, total: { $sum: '$rewardAmount' }, count: { $sum: 1 } } }
      ]),
      ReferralTransaction.aggregate([
        { $match: { referrerId: customerId, status: 'active', ...dateFilter } },
        { $group: { _id: null, total: { $sum: '$rewardAmount' }, count: { $sum: 1 } } }
      ])
    ]);

    const referralIds = await ReferralTransaction.distinct('referralId', {
      referrerId: customerId,
      ...searchQuery
    });

    const totalReferrals = await CustomerUser.countDocuments({
      referredBy: customerId,
      ...(Object.keys(searchQuery).length ? { _id: { $in: referralIds } } : {})
    });

    let referralQuery = { referredBy: customerId };
    if (search.trim()) {
      const safe = escapeRegex(String(search).slice(0, 100));
      const matchingUsers = await CustomerUser.find({
        $or: [
          { username: { $regex: safe, $options: 'i' } },
          { telegramUsername: { $regex: safe, $options: 'i' } },
          { uid: { $regex: safe, $options: 'i' } }
        ],
        referredBy: customerId
      }).select('_id');
      referralQuery = { _id: { $in: matchingUsers.map(u => u._id) } };
    }

    const referralUsers = await CustomerUser.find(referralQuery)
      .select('_id uid username telegramUsername createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const referralUserIds = referralUsers.map(u => u._id);

    const statsPerReferral = await ReferralTransaction.aggregate([
      { $match: { referrerId: customerId, referralId: { $in: referralUserIds }, status: 'active' } },
      {
        $group: {
          _id: '$referralId',
          orderCount: { $sum: 1 },
          totalEarned: { $sum: '$rewardAmount' },
          totalOrderAmount: { $sum: '$orderAmount' }
        }
      }
    ]);

    const statsMap = {};
    for (const s of statsPerReferral) statsMap[String(s._id)] = s;

    const referrals = referralUsers.map(u => ({
      _id: u._id,
      uid: u.uid,
      username: u.username,
      telegramUsername: u.telegramUsername,
      joinedAt: u.createdAt,
      orderCount: statsMap[String(u._id)]?.orderCount || 0,
      totalEarned: statsMap[String(u._id)]?.totalEarned || 0,
      totalOrderAmount: statsMap[String(u._id)]?.totalOrderAmount || 0
    }));

    return res.json({
      referralCode: user.referralCode,
      rates: effectiveRates,
      totalEarnedAllTime: allTime[0]?.total || 0,
      totalPurchasesAllTime: allTime[0]?.count || 0,
      periodEarned: periodData[0]?.total || 0,
      periodPurchases: periodData[0]?.count || 0,
      referrals,
      total: totalReferrals,
      pages: Math.ceil(totalReferrals / limitNum),
      page: pageNum
    });
  } catch (e) {
    console.error('[Referral] getMyReferralStats error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getAllReferrers = async (req, res) => {
  try {
    const { search = '', period = 'all', page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const dateFilter = {};
    const now = new Date();
    if (period === 'month') {
      dateFilter.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), 1) };
    } else if (period === 'quarter') {
      const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      dateFilter.createdAt = { $gte: qStart };
    }

    const aggregated = await ReferralTransaction.aggregate([
      { $match: { status: 'active', ...dateFilter } },
      {
        $group: {
          _id: '$referrerId',
          totalEarned: { $sum: '$rewardAmount' },
          purchaseCount: { $sum: 1 },
          referralSet: { $addToSet: '$referralId' }
        }
      },
      { $addFields: { referralCount: { $size: '$referralSet' } } },
      { $sort: { totalEarned: -1 } }
    ]);

    const referrerIds = aggregated.map(a => a._id);

    let filteredIds = referrerIds;
    if (search.trim()) {
      const safe = escapeRegex(String(search).slice(0, 100));
      const matching = await CustomerUser.find({
        _id: { $in: referrerIds },
        $or: [
          { username: { $regex: safe, $options: 'i' } },
          { telegramUsername: { $regex: safe, $options: 'i' } },
          { uid: { $regex: safe, $options: 'i' } }
        ]
      }).select('_id');
      filteredIds = matching.map(u => u._id.toString());
    }

    const filteredAgg = aggregated.filter(a => filteredIds.some(id => id.toString() === a._id.toString()));
    const total = filteredAgg.length;
    const pageSlice = filteredAgg.slice(skip, skip + limitNum);
    const pageIds = pageSlice.map(a => a._id);

    const users = await CustomerUser.find({ _id: { $in: pageIds } })
      .select('_id uid username telegramUsername email createdAt referralCode');

    const userMap = {};
    for (const u of users) userMap[String(u._id)] = u;

    const rows = pageSlice.map(a => {
      const u = userMap[String(a._id)] || {};
      return {
        _id: a._id,
        uid: u.uid,
        username: u.username,
        telegramUsername: u.telegramUsername,
        email: u.email,
        referralCode: u.referralCode,
        joinedAt: u.createdAt,
        totalEarned: a.totalEarned,
        purchaseCount: a.purchaseCount,
        referralCount: a.referralCount
      };
    });

    return res.json({ referrers: rows, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (e) {
    console.error('[Referral] getAllReferrers error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const searchCustomersForRate = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (!q) return res.json([]);
    const safe = escapeRegex(q);
    const users = await CustomerUser.find({
      $or: [
        { username: { $regex: safe, $options: 'i' } },
        { uid: { $regex: safe, $options: 'i' } }
      ]
    }).select('_id uid username telegramUsername').limit(10).lean();
    return res.json(users);
  } catch (e) {
    console.error('[Referral] searchCustomers error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getCustomerRates = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    let customerFilter = {};
    if (search.trim()) {
      const safe = escapeRegex(String(search).slice(0, 100));
      const isNumeric = /^\d+(\.\d+)?$/.test(search.trim());
      if (isNumeric) {
        const numVal = parseFloat(search.trim());
        const matchingByRate = await CustomerReferralRate.find({
          $or: [
            { googleAds: numVal },
            { youtube: numVal },
            { services: numVal }
          ]
        }).select('customerId').lean();
        const rateIds = matchingByRate.map(r => r.customerId);

        const matchingByUser = await CustomerUser.find({
          $or: [
            { username: { $regex: safe, $options: 'i' } },
            { uid: { $regex: safe, $options: 'i' } }
          ]
        }).select('_id').lean();
        const userIds = matchingByUser.map(u => u._id);

        const allIds = [...new Set([...rateIds.map(String), ...userIds.map(String)])];
        customerFilter = { customerId: { $in: allIds } };
      } else {
        const matchingUsers = await CustomerUser.find({
          $or: [
            { username: { $regex: safe, $options: 'i' } },
            { uid: { $regex: safe, $options: 'i' } }
          ]
        }).select('_id').lean();
        customerFilter = { customerId: { $in: matchingUsers.map(u => u._id) } };
      }
    }

    const total = await CustomerReferralRate.countDocuments(customerFilter);
    const rates = await CustomerReferralRate.find(customerFilter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const customerIds = rates.map(r => r.customerId);
    const customers = await CustomerUser.find({ _id: { $in: customerIds } })
      .select('_id uid username telegramUsername')
      .lean();
    const custMap = {};
    for (const c of customers) custMap[String(c._id)] = c;

    const rows = rates.map(r => {
      const c = custMap[String(r.customerId)] || {};
      return {
        _id: r._id,
        customerId: r.customerId,
        uid: c.uid || '',
        username: c.username || '',
        telegramUsername: c.telegramUsername || '',
        googleAds: r.googleAds,
        youtube: r.youtube,
        services: r.services,
        updatedAt: r.updatedAt
      };
    });

    return res.json({ rates: rows, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (e) {
    console.error('[Referral] getCustomerRates error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const setCustomerRate = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { googleAds, youtube, services } = req.body;

    const customer = await CustomerUser.findById(customerId).select('_id uid username telegramUsername');
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const update = {};
    if (googleAds !== undefined) update.googleAds = googleAds === null ? null : Math.min(100, Math.max(0, Number(googleAds)));
    if (youtube !== undefined) update.youtube = youtube === null ? null : Math.min(100, Math.max(0, Number(youtube)));
    if (services !== undefined) update.services = services === null ? null : Math.min(100, Math.max(0, Number(services)));

    const rate = await CustomerReferralRate.findOneAndUpdate(
      { customerId },
      { $set: update },
      { upsert: true, new: true, returnDocument: 'after' }
    );

    return res.json({
      _id: rate._id,
      customerId: rate.customerId,
      uid: customer.uid,
      username: customer.username,
      telegramUsername: customer.telegramUsername,
      googleAds: rate.googleAds,
      youtube: rate.youtube,
      services: rate.services,
      updatedAt: rate.updatedAt
    });
  } catch (e) {
    console.error('[Referral] setCustomerRate error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const deleteCustomerRate = async (req, res) => {
  try {
    const { customerId } = req.params;
    await CustomerReferralRate.findOneAndDelete({ customerId });
    return res.json({ message: 'Individual rate removed' });
  } catch (e) {
    console.error('[Referral] deleteCustomerRate error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getReferrerDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const referrer = await CustomerUser.findById(id).select('uid username telegramUsername email referralCode balance createdAt');
    if (!referrer) return res.status(404).json({ message: 'User not found' });

    const [summary, transactions, referralsRaw] = await Promise.all([
      ReferralTransaction.aggregate([
        { $match: { referrerId: referrer._id } },
        {
          $group: {
            _id: '$status',
            total: { $sum: '$rewardAmount' },
            count: { $sum: 1 }
          }
        }
      ]),
      ReferralTransaction.find({ referrerId: referrer._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('referralId', 'uid username telegramUsername'),
      CustomerUser.find({ referredBy: referrer._id }).select('uid username telegramUsername createdAt').sort({ createdAt: -1 })
    ]);

    const total = await ReferralTransaction.countDocuments({ referrerId: referrer._id });

    const summaryMap = {};
    for (const s of summary) summaryMap[s._id] = { total: s.total, count: s.count };

    return res.json({
      referrer,
      summary: {
        active: summaryMap['active'] || { total: 0, count: 0 },
        clawedBack: summaryMap['clawed_back'] || { total: 0, count: 0 }
      },
      transactions,
      referrals: referralsRaw,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum)
    });
  } catch (e) {
    console.error('[Referral] getReferrerDetail error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
};
