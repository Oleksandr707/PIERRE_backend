const express = require('express');
const mongoose = require('mongoose'); // Restored MongoDB connection
const cors = require('cors');
const dotenv = require('dotenv');
const { authenticateToken } = require('./middleware/authMiddleware'); // Restored auth middleware
// const Problem = require('./models/Problem'); // Temporarily commented out
// const Vote = require('./models/vote'); // Temporarily commented out
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bouldering-gym')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Serve uploaded files statically
app.use('/uploads', express.static('uploads'));

// Test endpoint to verify server is working
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server is working!', 
    timestamp: new Date().toISOString(),
    uploadsPath: path.join(__dirname, 'uploads')
  });
});

// Basic health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Backend server is running',
    port: process.env.PORT || 3001,
    timestamp: new Date().toISOString()
  });
});

// Door unlock endpoint
app.post('/api/door/unlock', authenticateToken, async (req, res) => {
  try {
    console.log('🚪 === DOOR UNLOCK REQUEST ===');
    console.log('User:', req.user);
    console.log('Body:', req.body);
    console.log('Headers:', req.headers);

    const userId = req.user.userId || req.user.id || req.user._id;
    const { location, testMode = false } = req.body;
    
    // Log the unlock attempt
    console.log('🔓 Door unlock attempt:', {
      userId: userId,
      location: location,
      testMode: testMode,
      timestamp: new Date().toISOString(),
      userAgent: req.headers['user-agent']
    });

    // For testing, always return success
    const response = {
      success: true,
      message: testMode ? 'Test door unlock successful!' : 'Door unlocked successfully!',
      timestamp: new Date().toISOString(),
      location: location,
      testMode: testMode,
      user: userId
    };

    console.log('✅ Door unlock response:', response);
    res.json(response);

  } catch (error) {
    console.error('❌ Door unlock error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Door unlock failed', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Routes - Restored MongoDB-based authentication
app.use('/api/auth', require('./routes/auth'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/stripe', require('./routes/stripe'));
app.use('/api/door-access', require('./routes/doorAccess'));
app.use('/api/problems', require('./routes/problems'));
app.use('/api/passes', require('./routes/passes'));
const guildsRouter = require('./routes/guilds');
app.use('/api/guilds', guildsRouter);

// Voting route
app.post('/api/problems/:id/vote', authenticateToken, async (req, res) => {
  // ... MongoDB dependent code commented out
});

// Get votes for a problem
app.get('/api/problems/:id/votes', authenticateToken, async (req, res) => {
  // ... MongoDB dependent code commented out
});

// Get detailed votes for a problem (with usernames)
app.get('/api/problems/:id/votes/details', authenticateToken, async (req, res) => {
  // ... MongoDB dependent code commented out
});

// Get all problems (for feed)
app.get('/api/problems', authenticateToken, async (req, res) => {
  // ... MongoDB dependent code commented out
});

// Get single problem by ID
app.get('/api/problems/:id', authenticateToken, async (req, res) => {
  // ... MongoDB dependent code commented out
});

// Create problem with image upload
app.post('/api/problems', authenticateToken, upload.single('image'), async (req, res) => {
  // ... MongoDB dependent code commented out
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));