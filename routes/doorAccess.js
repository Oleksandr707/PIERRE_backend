const express = require('express');
const router = express.Router();
const DoorAccess = require('../models/DoorAccess');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/authMiddleware');

// Log door access
router.post('/log-access', authenticateToken, async (req, res) => {
  try {
    console.log('=== DOOR ACCESS LOG REQUEST ===');
    console.log('User:', req.user);
    console.log('Request body:', req.body);

    const { location, status = 'success', sessionId, userLocation } = req.body;
    
    if (!location || !location.id || !location.name || !location.ip) {
      return res.status(400).json({ 
        message: 'Location information required (id, name, ip)' 
      });
    }

    const userId = req.user.userId || req.user.id || req.user._id;

    // Create door access log with user location
    const doorAccess = new DoorAccess({
      user: userId,
      location: {
        id: location.id,
        name: location.name,
        ip: location.ip
      },
      userLocation: userLocation ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        accuracy: userLocation.accuracy
      } : null,
      status,
      sessionId
    });

    await doorAccess.save();
    console.log('Door access logged:', doorAccess._id);

    res.status(201).json({
      message: 'Door access logged successfully',
      accessId: doorAccess._id,
      accessTime: doorAccess.accessTime
    });

  } catch (error) {
    console.error('Door access logging error:', error);
    res.status(500).json({ 
      message: 'Server error while logging door access', 
      error: error.message 
    });
  }
});

// Check if user can access door (spam protection and location verification)
router.post('/check-access', authenticateToken, async (req, res) => {
  try {
    const { locationId, userLocation } = req.body;
    const userId = req.user.userId || req.user.id || req.user._id;

    console.log('=== DOOR ACCESS CHECK ===');
    console.log('User:', userId);
    console.log('Location ID:', locationId);
    console.log('User Location:', userLocation);

    // Validate required fields
    if (!locationId) {
      return res.status(400).json({ 
        message: 'Location ID is required' 
      });
    }

    if (!userLocation || !userLocation.latitude || !userLocation.longitude) {
      return res.status(400).json({ 
        message: 'User location is required for security verification',
        code: 'LOCATION_REQUIRED'
      });
    }

    // Check for spam (max 3 attempts in 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));
    const recentAttempts = await DoorAccess.countDocuments({
      user: userId,
      'location.id': locationId,
      accessTime: { $gte: fiveMinutesAgo }
    });

    if (recentAttempts >= 3) {
      return res.status(429).json({
        message: 'Too many access attempts. Please wait before trying again.',
        code: 'RATE_LIMITED',
        waitTime: 300 // 5 minutes in seconds
      });
    }

    // Define location coordinates (in a real app, this would be in a database)
    const locationCoordinates = {
      '1': { // PIERRE MONT-ROYAL
        latitude: 45.5240,
        longitude: -73.5897,
        address: '2308 av mont-royal E, Montreal',
        radius: 50 // meters
      },
      '2': { // PIERRE SAINTE-CATHERINE
        latitude: 45.5017,
        longitude: -73.5673,
        address: 'Sainte-Catherine Street, Montreal',
        radius: 50
      },
      '3': { // PIERRE SAINT-LAURENT
        latitude: 45.5600,
        longitude: -73.5400,
        address: 'Saint-Laurent Boulevard, Montreal',
        radius: 50
      },
      '4': { // PIERRE CHINA TOWN
        latitude: 45.5080,
        longitude: -73.5600,
        address: 'China Town, Montreal',
        radius: 50
      },
      '5': { // PIERRE MANSFIELD
        latitude: 45.5030,
        longitude: -73.5780,
        address: 'Mansfield Street, Montreal',
        radius: 50
      },
      '6': { // PIERRE MILE END
        latitude: 45.5250,
        longitude: -73.6050,
        address: 'Mile End, Montreal',
        radius: 50
      }
    };

    const targetLocation = locationCoordinates[locationId];
    if (!targetLocation) {
      return res.status(400).json({
        message: 'Invalid location ID',
        code: 'INVALID_LOCATION'
      });
    }

    // Calculate distance using Haversine formula
    const distance = calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      targetLocation.latitude,
      targetLocation.longitude
    );

    console.log(`Distance to ${targetLocation.address}: ${distance}m (max: ${targetLocation.radius}m)`);

    if (distance > targetLocation.radius) {
      return res.status(403).json({
        message: `You are too far from ${targetLocation.address}. You need to be within ${targetLocation.radius} meters of the location.`,
        code: 'TOO_FAR',
        distance: Math.round(distance),
        maxDistance: targetLocation.radius,
        locationAddress: targetLocation.address
      });
    }

    // Check for recent successful access (prevent rapid successive opens)
    const oneMinuteAgo = new Date(Date.now() - (60 * 1000));
    const recentSuccess = await DoorAccess.findOne({
      user: userId,
      'location.id': locationId,
      accessTime: { $gte: oneMinuteAgo },
      status: 'success'
    });

    if (recentSuccess) {
      return res.status(429).json({
        message: 'You recently opened this door. Please wait before trying again.',
        code: 'RECENT_ACCESS',
        waitTime: 60
      });
    }

    res.json({
      success: true,
      message: 'Access authorized',
      location: targetLocation,
      distance: Math.round(distance)
    });

  } catch (error) {
    console.error('Door access check error:', error);
    res.status(500).json({ 
      message: 'Server error while checking door access', 
      error: error.message 
    });
  }
});

// Helper function to calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

// Get door access statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { locationId, hours = 1 } = req.query;
    const currentUserId = req.user.userId || req.user.id || req.user._id;
    
    // Calculate time range
    const hoursAgo = new Date(Date.now() - (hours * 60 * 60 * 1000));
    
    let query = {
      accessTime: { $gte: hoursAgo },
      status: 'success', // Only count successful accesses
      user: { $ne: currentUserId } // Exclude current user
    };
    
    // Filter by location if specified
    if (locationId) {
      query['location.id'] = locationId;
    }

    console.log('=== DOOR ACCESS STATS QUERY ===');
    console.log('Query:', query);
    console.log('Current user (excluded):', currentUserId);
    console.log('Time range: Last', hours, 'hours since', hoursAgo);

    // Get unique users count (excluding current user and counting each user only once per hour)
    const uniqueAccesses = await DoorAccess.aggregate([
      { $match: query },
      { 
        $group: { 
          _id: '$user', // Group by user
          firstAccess: { $min: '$accessTime' }, // Get first access in the time period
          lastAccess: { $max: '$accessTime' },
          accessCount: { $sum: 1 }
        }
      }
    ]);

    const uniqueUsers = uniqueAccesses.length;

    // Get total access count (before filtering duplicates)
    const totalAccessCount = await DoorAccess.countDocuments(query);

    // Get recent accesses with user info (last 10, excluding current user)
    const recentAccesses = await DoorAccess.find(query)
      .populate('user', 'firstName lastName username')
      .sort({ accessTime: -1 })
      .limit(10);

    console.log('Stats results:', {
      totalAccesses: totalAccessCount,
      uniqueUsers: uniqueUsers,
      recentCount: recentAccesses.length,
      excludedUser: currentUserId
    });

    res.json({
      timeRange: {
        hours: parseInt(hours),
        since: hoursAgo
      },
      stats: {
        totalAccesses: totalAccessCount,
        uniqueUsers: uniqueUsers // This represents unique people who accessed (excluding current user)
      },
      recentAccesses: recentAccesses.map(access => ({
        id: access._id,
        user: {
          name: access.user ? `${access.user.firstName || ''} ${access.user.lastName || ''}`.trim() || access.user.username : 'Unknown',
          username: access.user?.username
        },
        location: access.location,
        accessTime: access.accessTime,
        status: access.status
      }))
    });

  } catch (error) {
    console.error('Door access stats error:', error);
    res.status(500).json({ 
      message: 'Server error while fetching door access stats', 
      error: error.message 
    });
  }
});

// Get user's personal access history
router.get('/my-history', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, page = 1 } = req.query;
    const userId = req.user.userId || req.user.id || req.user._id;
    
    const skip = (page - 1) * limit;
    
    const accesses = await DoorAccess.find({ user: userId })
      .sort({ accessTime: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await DoorAccess.countDocuments({ user: userId });

    res.json({
      accesses: accesses.map(access => ({
        id: access._id,
        location: access.location,
        accessTime: access.accessTime,
        status: access.status
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Personal access history error:', error);
    res.status(500).json({ 
      message: 'Server error while fetching access history', 
      error: error.message 
    });
  }
});

// Get location-specific stats (for admin/detailed view)
router.get('/location-stats/:locationId', authenticateToken, async (req, res) => {
  try {
    const { locationId } = req.params;
    const { days = 7 } = req.query;
    
    const daysAgo = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    
    // Daily breakdown
    const dailyStats = await DoorAccess.aggregate([
      {
        $match: {
          'location.id': locationId,
          accessTime: { $gte: daysAgo },
          status: 'success'
        }
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$accessTime"
              }
            }
          },
          totalAccesses: { $sum: 1 },
          uniqueUsers: { $addToSet: '$user' }
        }
      },
      {
        $addFields: {
          uniqueUserCount: { $size: '$uniqueUsers' }
        }
      },
      {
        $sort: { '_id.date': 1 }
      }
    ]);

    res.json({
      locationId,
      timeRange: { days: parseInt(days), since: daysAgo },
      dailyBreakdown: dailyStats.map(stat => ({
        date: stat._id.date,
        totalAccesses: stat.totalAccesses,
        uniqueUsers: stat.uniqueUserCount
      }))
    });

  } catch (error) {
    console.error('Location stats error:', error);
    res.status(500).json({ 
      message: 'Server error while fetching location stats', 
      error: error.message 
    });
  }
});

module.exports = router; 