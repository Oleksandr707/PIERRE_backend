const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const Stripe = require('stripe');
require('dotenv').config();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const Pass = require('../models/Pass');

// ===========================
//  Friday deal configuration
// ===========================
const GYM_TZ = 'America/Toronto'; // Change if your gym uses a different local timezone

function isFridayInTZ(date = new Date(), tz = GYM_TZ) {
  // Returns true if the given date is Friday in the specified timezone
  return (
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, weekday: 'short' }).format(date) === 'Fri'
  );
}

function getPassPriceUSD(passType, date = new Date()) {
  switch (passType) {
    case 'day':
      return isFridayInTZ(date) ? 10 : 25; // <-- Friday deal
    case 'week':
      return 77;
    case 'month':
      return 90;
    case 'year':
      return 777;
    default:
      throw new Error('Invalid pass type');
  }
}

// Pass durations (ms)
const PASS_DURATIONS = {
  // NOTE: This was 7 hours in your original file. Keep or change as you wish.
  day: 7 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

// Stripe products (ids used as metadata or for reference only)
const STRIPE_PRODUCTS = {
  day:   { productId: 'prod_SRMtkNFSC1Vuw1', priceId: 'price_1Rqc02Kje5iG0GVieA3OxBgT' },
  week:  { productId: 'prod_SRMwDPRP7Xrok6', priceId: 'price_1RWUChKje5iG0GViCpr7WucW' },
  month: { productId: 'prod_SRMxnjgFNeWDZP', priceId: 'price_1RWUDeKje5iG0GViMiosJ4FC' },
  year:  { productId: 'prod_SRMy92JS4lJ5BB', priceId: 'price_1RqbvlKje5iG0GVi6KrYd5Rm' },
};

// ===========================
//  Routes
// ===========================

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

    res.json({
      pass: pass
        ? {
            id: pass._id,
            type: pass.type,
            startTime: pass.startTime,
            endTime: pass.endTime,
            purchasedAt: pass.purchasedAt,
            paymentIntentId: pass.paymentIntentId,
            stripeProductId: pass.stripeProductId,
            price: pass.price,
            status: pass.status
          }
        : null
    });
  } catch (error) {
    console.error('❌ Error fetching pass status:', error);
    res.status(500).json({ error: 'Failed to fetch pass status', message: error.message });
  }
});

// Activate pass after payment (verifies PaymentIntent if provided)
router.post('/activate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
    const { paymentIntentId, passType, stripeProductId } = req.body;

    if (!passType || !['day', 'week', 'month', 'year'].includes(passType)) {
      return res.status(400).json({
        error: 'Invalid pass type',
        message: 'Pass type must be either "day", "week", "month", or "year"',
      });
    }

    // Determine actual price (prefer Stripe PI if we have it and it succeeded)
    let priceUSD = getPassPriceUSD(passType);
    let chargedCurrency = null;

    if (paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        // If payment succeeded or is otherwise confirmed, use the charged amount
        const cents =
          typeof pi.amount_received === 'number' && pi.amount_received > 0
            ? pi.amount_received
            : pi.amount;
        priceUSD = (cents || 0) / 100;
        chargedCurrency = pi.currency;
      } catch (e) {
        console.warn('⚠️ Could not retrieve PI; falling back to computed price.', e?.message);
      }
    }

    // Expire existing active passes
    const now = new Date();
    await Pass.updateMany(
      { user: userId, status: 'active', endTime: { $gt: now } },
      { $set: { status: 'expired' } }
    );

    // Create new active pass
    const startTime = now;
    const endTime = new Date(now.getTime() + PASS_DURATIONS[passType]);

    const newPass = await Pass.create({
      user: userId,
      startTime,
      endTime,
      type: passType,
      paymentIntentId: paymentIntentId || null,
      stripeProductId: stripeProductId || STRIPE_PRODUCTS[passType].productId,
      price: priceUSD, // store actual price charged (or computed)
      status: 'active',
      purchasedAt: startTime,
      ...(chargedCurrency ? { currency: chargedCurrency } : {})
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

// Informational purchase endpoint
router.post('/purchase', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
    const { type } = req.body;

    if (!type || !['day', 'week', 'month', 'year'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid pass type',
        message: 'Pass type must be either "day", "week", "month", or "year"'
      });
    }

    const now = new Date();
    const existing = await Pass.findOne({
      user: userId,
      status: 'active',
      endTime: { $gt: now }
    });

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
        price: getPassPriceUSD(type),
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
    const pass = await Pass.findOne({
      user: userId,
      status: 'active',
      endTime: { $gt: now }
    }).sort({ endTime: -1 });

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

// Admin: view all passes
router.get('/admin/all', authenticateToken, async (req, res) => {
  try {
    const passes = await Pass.find({}).sort({ startTime: -1 }).populate('user');
    res.json({
      passes,
      total: passes.length,
      active: passes.filter(
        (p) => new Date() < new Date(p.endTime) && p.status === 'active'
      ).length
    });
  } catch (error) {
    console.error('❌ Error fetching all passes:', error);
    res.status(500).json({ error: 'Failed to fetch passes', message: error.message });
  }
});

// Stripe create-intent (server computes amount; ignores client "amount")
router.post('/stripe/create-intent', authenticateToken, async (req, res) => {
  try {
    const { passType, currency = 'usd' } = req.body;
    if (!passType || !['day', 'week', 'month', 'year'].includes(passType)) {
      return res.status(400).json({ error: 'Invalid or missing passType' });
    }

    const amountCents = Math.round(getPassPriceUSD(passType) * 100);

    console.log(
      'Stripe key used:',
      (process.env.STRIPE_SECRET_KEY || '').substring(0, 10),
      '...'
    );
    console.log('Computed amount (cents):', amountCents, 'passType:', passType);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId: req.user.userId || req.user.id || req.user._id,
        passType
      }
    });

    res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (err) {
    console.error('❌ Stripe create-intent error:', err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
