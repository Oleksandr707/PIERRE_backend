// routes/stripe.js
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { authenticateToken } = require('../middleware/authMiddleware');
const User = require('../models/User');
const Pass = require('../models/Pass');

const router = express.Router();

// ===========================
//  Currency & Friday deal
// ===========================
const CURRENCY = 'cad';                    // <- charge in CAD
const GYM_TZ = 'America/Toronto';          // change to your local timezone if needed

function isFridayInTZ(date = new Date(), tz = GYM_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, weekday: 'short' }).format(date) === 'Fri';
}

// All prices expressed in CAD dollars
function getPassPriceCAD(passType, date = new Date()) {
  switch (passType) {
    case 'day':   return isFridayInTZ(date) ? 10 : 25; // Friday deal in CAD
    case 'week':  return 77;
    case 'month': return 90;
    case 'year':  return 777;
    default: throw new Error('Invalid pass type');
  }
}

// Pass durations (ms) – kept consistent with /routes/passes.js
const PASS_DURATIONS = {
  day: 7 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

// Stripe product references (for metadata / reporting)
const STRIPE_PRODUCTS = {
  day:   { productId: 'prod_SRMtkNFSC1Vuw1', priceId: 'price_1Rqc02Kje5iG0GVieA3OxBgT' },
  week:  { productId: 'prod_SRMwDPRP7Xrok6', priceId: 'price_1RWUChKje5iG0GViCpr7WucW' },
  month: { productId: 'prod_SRMxnjgFNeWDZP', priceId: 'price_1RWUDeKje5iG0GViMiosJ4FC' },
  year:  { productId: 'prod_SRMy92JS4lJ5BB', priceId: 'price_1RqbvlKje5iG0GVi6KrYd5Rm' }
};

router.get('/config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// Ensure a Stripe customer exists for this user
async function ensureCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const c = await stripe.customers.create({
    email: user.email,
    name: user.username,
    metadata: { userId: String(user._id) }
  });
  user.stripeCustomerId = c.id;
  await user.save();
  return c.id;
}

// --- Create PaymentIntent (expects passType, ignores any client "amount") ---
router.post('/create-payment-intent', authenticateToken, async (req, res) => {
  try {
    const { passType, metadata = {} } = req.body;
    if (!passType || !['day', 'week', 'month', 'year'].includes(passType)) {
      return res.status(400).json({ error: 'Invalid pass type' });
    }

    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const customerId = await ensureCustomer(user);
    const amountCents = Math.round(getPassPriceCAD(passType) * 100);

    const product = STRIPE_PRODUCTS[passType];

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: CURRENCY, // <- CAD
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      setup_future_usage: 'off_session',
      metadata: {
        userId: userId.toString(),
        passType,
        productId: product?.productId,
        priceId: product?.priceId,
        type: 'pass_purchase',
        ...metadata
      }
    });

    console.log('🧩 [create-payment-intent] customer:', customerId, 'PI:', paymentIntent.id, 'amount:', amountCents, CURRENCY);

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: amountCents,
      passType
    });
  } catch (error) {
    console.error('❌ Error creating live payment intent:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Alias route your frontend may call (supports amount or passType) ---
router.post('/create-intent', authenticateToken, async (req, res) => {
  try {
    const { amount, passType = '', metadata = {} } = req.body;

    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const customerId = await ensureCustomer(user);

    // If passType is provided, server computes the amount in CAD (Friday discount applied)
    let amountCents;
    if (passType && ['day', 'week', 'month', 'year'].includes(passType)) {
      amountCents = Math.round(getPassPriceCAD(passType) * 100);
    } else {
      // Fallback to explicit amount (e.g., for non-pass products)
      const parsed = parseInt(amount, 10);
      amountCents = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: CURRENCY, // <- always CAD
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      setup_future_usage: 'off_session',
      metadata: {
        userId: String(userId),
        passType,
        type: 'pass_purchase',
        ...metadata
      }
    });

    console.log('🧩 [/create-intent] customer:', customerId, 'PI:', paymentIntent.id, 'amount:', amountCents, CURRENCY);

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: amountCents,
      passType
    });
  } catch (error) {
    console.error('❌ Error in /create-intent:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Create subscription (unchanged currency here — ensure your priceId is CAD in Stripe)
router.post('/create-subscription', authenticateToken, async (req, res) => {
  try {
    const { priceId, paymentMethodId } = req.body;
    const userId = req.user.id || req.user._id;

    if (!priceId || !paymentMethodId) {
      return res.status(400).json({ error: 'Price ID and Payment Method ID are required' });
    }

    let user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const customerId = await ensureCustomer(user);

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }], // make sure this priceId is a CAD price in Stripe
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
    });

    res.json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      status: subscription.status
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's subscriptions
router.get('/subscriptions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);

    if (!user || !user.stripeCustomerId) {
      return res.json({ subscriptions: [] });
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: 'all',
      expand: ['data.default_payment_method']
    });

    res.json({ subscriptions: subscriptions.data });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel subscription
router.delete('/subscription/:subscriptionId', authenticateToken, async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const { cancelAtPeriodEnd = true } = req.body;

    if (cancelAtPeriodEnd) {
      const subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true
      });
      res.json({ subscription, message: 'Subscription will cancel at the end of the billing period' });
    } else {
      const subscription = await stripe.subscriptions.cancel(subscriptionId);
      res.json({ subscription, message: 'Subscription cancelled immediately' });
    }
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stripe products passthrough
router.get('/products', async (req, res) => {
  try {
    const products = await stripe.products.list({ active: true, expand: ['data.default_price'] });
    const prices = await stripe.prices.list({ active: true, expand: ['data.product'] });

    res.json({ products: products.data, prices: prices.data });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook to handle successful payments and activate passes
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object;
      console.log('💰 Payment succeeded:', paymentIntent.id);
      await activatePassAfterPayment(paymentIntent);
      break;
    }
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// Activate pass after successful payment (server of record)
async function activatePassAfterPayment(paymentIntent) {
  try {
    const { userId, passType, productId } = paymentIntent.metadata || {};

    if (!userId || !passType || !['day', 'week', 'month', 'year'].includes(passType)) {
      console.error('❌ Invalid payment metadata:', paymentIntent.metadata);
      return;
    }

    const now = new Date();

    // Expire any existing active passes for this user
    await Pass.updateMany(
      { user: userId, status: 'active', endTime: { $gt: now } },
      { $set: { status: 'expired' } }
    );

    // Use the actual amount charged from Stripe (fallback to computed if missing)
    const chargedCents =
      (typeof paymentIntent.amount_received === 'number' && paymentIntent.amount_received > 0)
        ? paymentIntent.amount_received
        : paymentIntent.amount;

    const chargedCAD = (chargedCents || 0) / 100;

    // Create the pass
    const passDoc = new Pass({
      user: userId, // ref to User
      type: passType,
      startTime: now,
      endTime: new Date(now.getTime() + PASS_DURATIONS[passType]),
      purchasedAt: now,
      price: chargedCAD, // store CAD amount
      duration: PASS_DURATIONS[passType],
      paymentIntentId: paymentIntent.id,
      stripeProductId: productId || STRIPE_PRODUCTS[passType]?.productId,
      status: 'active',
      currency: paymentIntent.currency // should be 'cad'
    });

    await passDoc.save();
    console.log('✅ Pass activated after payment:', passDoc._id.toString());
  } catch (error) {
    console.error('❌ Error activating pass after payment:', error);
  }
}

module.exports = router;
