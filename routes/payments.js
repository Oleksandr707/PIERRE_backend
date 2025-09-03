// routes/payments.js
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Simple auth middleware (re-use elsewhere if you like)
async function requireAuth(req, res, next) {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'No token provided' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (e) {
    console.error('Auth error:', e);
    return res.status(401).json({ message: 'Invalid token' });
  }
}

/**
 * POST /api/payments/create-setup-intent
 * Creates a SetupIntent for the current user and returns its client_secret.
 */
router.post('/create-setup-intent', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Ensure Stripe Customer exists
    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { appUserId: String(user._id) },
      });
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    // Create a SetupIntent linked to the customer
    const setupIntent = await stripe.setupIntents.create({
      customer: user.stripeCustomerId,
      usage: 'off_session',
      automatic_payment_methods: { enabled: true },
    });

    res.json({ clientSecret: setupIntent.client_secret });
  } catch (error) {
    console.error('Create SetupIntent error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * (Optional) GET /api/payments/list
 * List saved card payment methods for the customer.
 */
router.get('/list', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user || !user.stripeCustomerId) return res.json({ paymentMethods: [] });

    const list = await stripe.paymentMethods.list({
      customer: user.stripeCustomerId,
      type: 'card',
    });

    res.json({ paymentMethods: list.data });
  } catch (error) {
    console.error('List PMs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * (Optional) POST /api/payments/set-default
 * Set the default invoice payment method on the customer.
 * body: { paymentMethodId: string }
 */
router.post('/set-default', requireAuth, async (req, res) => {
  try {
    const { paymentMethodId } = req.body;
    const user = await User.findById(req.userId);
    if (!user || !user.stripeCustomerId) return res.status(404).json({ message: 'User or customer not found' });

    await stripe.customers.update(user.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    res.json({ message: 'Default payment method updated' });
  } catch (error) {
    console.error('Set default error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * GET /api/payments/customer-sheet
 * Returns { customerId, ephemeralKeySecret, hasSavedCard }
 */
router.get('/customer-sheet', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { appUserId: String(user._id) },
      });
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: user.stripeCustomerId },
      { apiVersion: '2024-06-20' }
    );

    const pms = await stripe.paymentMethods.list({
      customer: user.stripeCustomerId,
      type: 'card',
    });

    console.log('🧩 [customer-sheet] customerId:', user.stripeCustomerId);

    res.json({
      customerId: user.stripeCustomerId,
      ephemeralKeySecret: ephemeralKey.secret,
      hasSavedCard: (pms.data?.length || 0) > 0,
    });
  } catch (err) {
    console.error('customer-sheet error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
