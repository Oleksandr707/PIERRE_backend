const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { _id: decoded.userId };
    req.userId = decoded.userId; // Keep for backward compatibility
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid' });
  }
}; 