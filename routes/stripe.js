const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { authenticateToken } = require('../middleware/authMiddleware');
const User = require('../models/User');

const isLiveKey = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_live_');
const keyType = isLiveKey ? 'live' : 'test';
console.log(`💳 Stripe module loaded with ${keyType} secret key:`, process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.substring(0, 20) + '...' : 'Using fallback test key');

const router = express.Router();

// Real Stripe products mapping
const STRIPE_PRODUCTS = {
  day: {
    productId: 'prod_SRMtkNFSC1Vuw1',
    priceId: 'price_1RWUA5Kje5iG0GViRUNutvbL',
    amount: 2500, // $25.00 in cents
    duration: 7 * 60 * 60 * 1000, // 7 hours in milliseconds
    type: 'day'
  },
  week: {
    productId: 'prod_SRMwDPRP7Xrok6', 
    priceId: 'price_1RWUChKje5iG0GViCpr7WucW',
    amount: 12000, // $120.00 in cents
    duration: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    type: 'week'
  },
  month: {
    productId: 'prod_SRMxnjgFNeWDZP',
    priceId: 'price_1RWUDeKje5iG0GViMiosJ4FC',
    amount: 40000, // $400.00 in cents
    duration: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
    type: 'month'
  },
  year: {
    productId: 'prod_SRMy92JS4lJ5BB',
    priceId: 'price_1RWUEPKje5iG0GVik2sVHsu9',
    amount: 400000, // $4000.00 in cents
    duration: 365 * 24 * 60 * 60 * 1000, // 365 days in milliseconds
    type: 'year'
  }
};

// Get Stripe publishable key
// stripe.js
router.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
  });
});


// Create payment intent for pass purchases using real Stripe products
router.post('/create-payment-intent', authenticateToken, async (req, res) => {
  console.log('💰 ===== LIVE PAYMENT INTENT CREATION =====');
  console.log('🎫 User:', req.user);
  console.log('📝 Request body:', req.body);
  
  try {
    const { passType, couponCode, metadata = {} } = req.body;
    
    if (!passType || !STRIPE_PRODUCTS[passType]) {
      return res.status(400).json({ error: 'Invalid pass type' });
    }

    const product = STRIPE_PRODUCTS[passType];
    const userId = req.user.userId || req.user.id || req.user._id;
    
    console.log('💵 Creating payment for:', {
      passType,
      productId: product.productId,
      priceId: product.priceId,
      amount: product.amount,
      userId,
      couponCode
    });

    // Create payment intent with real product
    const paymentIntentData = {
      amount: product.amount,
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        userId: userId.toString(),
        passType: passType,
        productId: product.productId,
        priceId: product.priceId,
        type: 'pass_purchase',
        ...metadata
      }
    };

    // Add coupon for yearly passes if provided
    if (passType === 'year' && couponCode) {
      try {
        // Validate the coupon exists in Stripe
        const coupon = await stripe.coupons.retrieve(couponCode);
        paymentIntentData.metadata.couponCode = couponCode;
        console.log('✅ Coupon validated:', coupon.id);
      } catch (couponError) {
        console.log('❌ Invalid coupon code:', couponCode);
        return res.status(400).json({ error: 'Invalid coupon code' });
      }
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentData);
    
    console.log('✅ Live PaymentIntent created:', {
      id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      passType: passType
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: product.amount,
      passType: passType
    });

  } catch (error) {
    console.error('❌ Error creating live payment intent:', error);
    res.status(500).json({ error: error.message });
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
        metadata: {
          userId: userId.toString()
        }
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    // Set as default payment method
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
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
    const products = await stripe.products.list({
      active: true,
      expand: ['data.default_price']
    });

    const prices = await stripe.prices.list({
      active: true,
      expand: ['data.product']
    });

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
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('💰 Payment succeeded:', paymentIntent.id);
      
      // Activate the pass for the user
      await activatePassAfterPayment(paymentIntent);
      break;
    
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({received: true});
});

// Function to activate pass after successful payment
async function activatePassAfterPayment(paymentIntent) {
  try {
    const { userId, passType, productId } = paymentIntent.metadata;
    
    if (!userId || !passType || !STRIPE_PRODUCTS[passType]) {
      console.error('❌ Invalid payment metadata:', paymentIntent.metadata);
      return;
    }

    const product = STRIPE_PRODUCTS[passType];
    const Pass = require('../models/Pass');
    
    // Create new pass
    const newPass = new Pass({
      id: `live_pass_${userId}_${Date.now()}`,
      userId: userId,
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
    const User = require('../models/User');
    await User.findByIdAndUpdate(userId, {
      currentPassId: newPass.id,
      lastPurchaseDate: new Date()
    });

  } catch (error) {
    console.error('❌ Error activating pass after payment:', error);
  }
}

module.exports = router; 