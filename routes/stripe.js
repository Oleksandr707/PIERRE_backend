// routes/stripe.js
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { authenticateToken } = require('../middleware/authMiddleware');
const User = require('../models/User');

const router = express.Router();

const STRIPE_PRODUCTS = {
  day:   { productId: 'prod_SRMtkNFSC1Vuw1', priceId: 'price_1RWUA5Kje5iG0GViRUNutvbL', amount: 2500,   duration: 7 * 60 * 60 * 1000,  type: 'day' },
  week:  { productId: 'prod_SRMwDPRP7Xrok6', priceId: 'price_1RWUChKje5iG0GViCpr7WucW', amount: 12000,  duration: 7 * 24 * 60 * 60 * 1000, type: 'week' },
  month: { productId: 'prod_SRMxnjgFNeWDZP', priceId: 'price_1RWUDeKje5iG0GViMiosJ4FC', amount: 40000,  duration: 30 * 24 * 60 * 60 * 1000, type: 'month' },
  year:  { productId: 'prod_SRMy92JS4lJ5BB', priceId: 'price_1RWUEPKje5iG0GVik2sVHsu9', amount: 400000, duration: 365 * 24 * 60 * 60 * 1000, type: 'year' }
};

router.get('/config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// --- helper to ensure we have a Stripe customer for this user ---
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

// ---------- ORIGINAL ROUTE (just 2 lines added) ----------
router.post('/create-payment-intent', authenticateToken, async (req, res) => {
  // ... your existing logs ...
  try {
    const { passType, couponCode, metadata = {} } = req.body;
    if (!passType || !STRIPE_PRODUCTS[passType]) {
      return res.status(400).json({ error: 'Invalid pass type' });
    }

    const product = STRIPE_PRODUCTS[passType];

    // 🔐 Get app user and ensure Stripe customer
    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.username,
        metadata: { userId: userId.toString() }
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    // ✅ CRITICAL: include `customer`
    const paymentIntent = await stripe.paymentIntents.create({
      amount: product.amount,
      currency: 'usd',
      customer: customerId,                     // <-- required
      automatic_payment_methods: { enabled: true },
      setup_future_usage: 'off_session',        // optional
      metadata: {
        userId: userId.toString(),
        passType,
        productId: product.productId,
        priceId: product.priceId,
        type: 'pass_purchase',
        ...metadata
      }
    });

    console.log('🧩 [create-payment-intent] customer:', customerId, 'PI:', paymentIntent.id);

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: product.amount,
      passType
    });
  } catch (error) {
    console.error('❌ Error creating live payment intent:', error);
    res.status(500).json({ error: error.message });
  }
});



// ---------- ALIAS ROUTE your frontend calls ----------
router.post('/create-intent', authenticateToken, async (req, res) => {
  try {
    const { amount, currency = 'usd', passType = '', metadata = {} } = req.body;

    // 1) Resolve your app user
    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // 2) Ensure Stripe Customer exists for this app user
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.username,
        metadata: { userId: String(userId) }
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    // 3) Build amount safely (Stripe needs integer)
    const amt = Math.max(1, parseInt(amount, 10));

    // 4) ✅ Create PaymentIntent **with the same customer**
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amt,
      currency,
      customer: customerId,                           // <-- CRITICAL
      automatic_payment_methods: { enabled: true },
      setup_future_usage: 'off_session',              // optional
      metadata: {
        userId: String(userId),
        passType,
        type: 'pass_purchase',
        ...metadata
      }
    });

    console.log('🧩 [/create-intent] customer:', customerId,
                'PI:', paymentIntent.id, 'amount:', amt);

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: amt,
      passType
    });
  } catch (error) {
    console.error('❌ Error in /create-intent:', error);
    return res.status(500).json({ error: error.message });
  }
});


// Create subscription
router.post('/create-subscription', authenticateToken, async (req, res) => {
  try {
    const { priceId, paymentMethodId } = req.body;
    const userId = req.user.id || req.user._id;

    if (!priceId || !paymentMethodId) {
      return res.status(400).json({ error: 'Price ID and Payment Method ID are required' });
    }

    // Create customer if doesn't exist
    let user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.username,
        metadata: { userId: userId.toString() }
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });

    // Set as default payment method
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
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

// Get products and prices
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
router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
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

  res.json({received: true});
});

// Function to activate pass after successful payment
async function activatePassAfterPayment(paymentIntent) {
  try {
    const STRIPE_PRODUCTS_LOCAL = STRIPE_PRODUCTS;
    const { userId, passType, productId } = paymentIntent.metadata || {};

    if (!userId || !passType || !STRIPE_PRODUCTS_LOCAL[passType]) {
      console.error('❌ Invalid payment metadata:', paymentIntent.metadata);
      return;
    }

    const product = STRIPE_PRODUCTS_LOCAL[passType];
    const Pass = require('../models/Pass');

    // Create new pass
    const newPass = new Pass({
      id: `live_pass_${userId}_${Date.now()}`,
      userId,
      type: passType,
      startTime: new Date(),
      endTime: new Date(Date.now() + product.duration),
      purchasedAt: new Date(),
      price: product.amount / 100, // Convert back to dollars
      duration: product.duration,
      paymentIntentId: paymentIntent.id,
      stripeProductId: productId,
      status: 'active'
    });

    await newPass.save();
    console.log('✅ Pass activated after payment:', newPass.id);

    // Update user's pass status
    await User.findByIdAndUpdate(userId, {
      currentPassId: newPass.id,
      lastPurchaseDate: new Date()
    });

  } catch (error) {
    console.error('❌ Error activating pass after payment:', error);
  }
}

module.exports = router;
