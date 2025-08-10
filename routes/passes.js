const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const Stripe = require('stripe');
require('dotenv').config();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const Pass = require('../models/Pass');

// Pass durations/prices/Stripe product info
const PASS_DURATIONS = {
  day: 7 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};
const PASS_PRICES = { day: 1, week: 120, month: 400, year: 4000 };
// const STRIPE_PRODUCTS = {
//   day: { productId: 'prod_SRMtkNFSC1Vuw1', priceId: 'price_1RWUA5Kje5iG0GViRUNutvbL' },
//   week: { productId: 'prod_SRMwDPRP7Xrok6', priceId: 'price_1RWUChKje5iG0GViCpr7WucW' },
//   month: { productId: 'prod_SRMxnjgFNeWDZP', priceId: 'price_1RWUDeKje5iG0GViMiosJ4FC' },
//   year: { productId: 'prod_SRMy92JS4lJ5BB', priceId: 'price_1RWUEPKje5iG0GVik2sVHsu9' },
// };
const STRIPE_PRODUCTS = {
  day: { productId: 'prod_SRMtkNFSC1Vuw1', priceId: 'price_1RqyklKje5iG0GVijgBgeTws' },
  week: { productId: 'prod_SRMwDPRP7Xrok6', priceId: 'price_1RWUChKje5iG0GViCpr7WucW' },
  month: { productId: 'prod_SRMxnjgFNeWDZP', priceId: 'price_1RWUDeKje5iG0GViMiosJ4FC' },
  year: { productId: 'prod_SRMy92JS4lJ5BB', priceId: 'price_1RWUEPKje5iG0GVik2sVHsu9' },
};

// Get current active pass
router.get('/current', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
    const now = new Date();
    const pass = await Pass.findOne({
      user: userId,
      status: 'active',
      endTime: { $gt: now }
    }).sort({ endTime: -1 });

    res.json({ pass: pass ? {
      id: pass._id,
      type: pass.type,
      startTime: pass.startTime,
      endTime: pass.endTime,
      purchasedAt: pass.purchasedAt,
      paymentIntentId: pass.paymentIntentId,
      stripeProductId: pass.stripeProductId,
      price: pass.price,
      status: pass.status
    } : null });
  } catch (error) {
    console.error('❌ Error fetching pass status:', error);
    res.status(500).json({ error: 'Failed to fetch pass status', message: error.message });
  }
});

// Activate pass after payment
router.post('/activate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
    const { paymentIntentId, passType, stripeProductId } = req.body;

    if (!passType || !['day', 'week', 'month', 'year'].includes(passType)) {
      return res.status(400).json({ error: 'Invalid pass type', message: 'Pass type must be either "day", "week", "month", or "year"' });
    }

    // Expire existing passes
    const now = new Date();
    await Pass.updateMany({ user: userId, status: 'active', endTime: { $gt: now } }, { $set: { status: 'expired' } });

    // Create pass
    const startTime = now;
    const endTime = new Date(now.getTime() + PASS_DURATIONS[passType]);
    const newPass = await Pass.create({
      user: userId,
      startTime,
      endTime,
      type: passType,
      paymentIntentId,
      stripeProductId: stripeProductId || STRIPE_PRODUCTS[passType].productId,
      price: PASS_PRICES[passType],
      status: 'active',
      purchasedAt: startTime
    });

    res.json({
      success: true,
      message: `${passType.charAt(0).toUpperCase() + passType.slice(1)} pass activated successfully!`,
      pass: {
        id: newPass._id,
        type: newPass.type,
        startTime: newPass.startTime,
        endTime: newPass.endTime,
        purchasedAt: newPass.purchasedAt,
        price: newPass.price,
        paymentIntentId: newPass.paymentIntentId,
        stripeProductId: newPass.stripeProductId,
        status: newPass.status
      }
    });
  } catch (error) {
    console.error('❌ Error activating pass:', error);
    res.status(500).json({ error: 'Failed to activate pass', message: error.message });
  }
});

// Pass purchase endpoint (for info only)
router.post('/purchase', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
    const { type } = req.body;

    if (!type || !['day', 'week', 'month', 'year'].includes(type)) {
      return res.status(400).json({ error: 'Invalid pass type', message: 'Pass type must be either "day", "week", "month", or "year"' });
    }

    const now = new Date();
    const existing = await Pass.findOne({ user: userId, status: 'active', endTime: { $gt: now } });

    if (existing) {
      return res.status(400).json({
        error: 'Active pass exists',
        message: 'You already have an active pass. Wait for it to expire before purchasing a new one.',
        existingPass: { type: existing.type, endTime: existing.endTime }
      });
    }

    res.json({
      success: false,
      requiresPayment: true,
      message: 'Pass purchase requires payment through Stripe',
      passInfo: {
        type,
        price: PASS_PRICES[type],
        duration: PASS_DURATIONS[type],
        stripeProduct: STRIPE_PRODUCTS[type]
      },
      redirectTo: '/payment',
      instructions: 'Use the Stripe payment flow to complete your purchase'
    });

  } catch (error) {
    console.error('❌ Error processing pass purchase request:', error);
    res.status(500).json({ error: 'Failed to process purchase request', message: error.message });
  }
});

// Get pass history for user
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
    const passes = await Pass.find({ user: userId }).sort({ startTime: -1 });
    res.json({ passes, total: passes.length });
  } catch (error) {
    console.error('❌ Error fetching pass history:', error);
    res.status(500).json({ error: 'Failed to fetch pass history', message: error.message });
  }
});

// Validate current pass (for door access)
router.get('/validate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
    const now = new Date();
    const pass = await Pass.findOne({ user: userId, status: 'active', endTime: { $gt: now } }).sort({ endTime: -1 });

    if (!pass) {
      return res.json({ valid: false, message: 'No active pass found' });
    }
    const remainingTime = new Date(pass.endTime).getTime() - now.getTime();
    res.json({
      valid: true,
      pass: {
        type: pass.type,
        remainingTime,
        endTime: pass.endTime
      },
      message: 'Pass is valid'
    });
  } catch (error) {
    console.error('❌ Error validating pass:', error);
    res.status(500).json({ error: 'Failed to validate pass', message: error.message });
  }
});

// Admin endpoint to view all active passes
router.get('/admin/all', authenticateToken, async (req, res) => {
  try {
    const passes = await Pass.find({}).sort({ startTime: -1 }).populate('user');
    res.json({
      passes,
      total: passes.length,
      active: passes.filter(pass => new Date() < new Date(pass.endTime) && pass.status === 'active').length
    });
  } catch (error) {
    console.error('❌ Error fetching all passes:', error);
    res.status(500).json({ error: 'Failed to fetch passes', message: error.message });
  }
});

// Stripe create-intent endpoint
router.post('/stripe/create-intent', authenticateToken, async (req, res) => {
  try {
    const { amount, currency = "cad", passType } = req.body;
    if (!amount) return res.status(400).json({ error: "Amount is required" });

    // Debug log
    console.log("Stripe key used:", process.env.STRIPE_SECRET_KEY.substring(0, 10), "...");
    console.log("Amount for PaymentIntent:", amount);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId: req.user.userId || req.user.id || req.user._id,
        passType: passType || 'unknown'
      }
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('❌ Stripe create-intent error:', err);
    res.status(400).json({ error: err.message });
  }
});


module.exports = router;
