const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const mime = require('mime-types');
const requestIp = require('request-ip');
const geoip = require('geoip-lite');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(requestIp.mw());

// Storage configuration untuk berbagai jenis media
const createMulterStorage = (folder) => {
  return multer.diskStorage({
    destination: function (req, file, cb) {
      const uploadPath = `uploads/${folder}/`;
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      cb(null, uniqueSuffix + ext);
    }
  });
};

// File filter untuk validasi tipe file
const fileFilter = (req, file, cb) => {
  const allowedTypes = {
    'image': ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    'video': ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm'],
    'audio': ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/m4a'],
    'document': ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
  };

  const allAllowedTypes = [...allowedTypes.image, ...allowedTypes.video, ...allowedTypes.audio, ...allowedTypes.document];
  
  if (allAllowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed'), false);
  }
};

// Multer configurations
const uploadVoice = multer({ 
  storage: createMulterStorage('voice'),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

const uploadMedia = multer({ 
  storage: createMulterStorage('media'),
  fileFilter: fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

const uploadImage = multer({ 
  storage: createMulterStorage('images'),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed'), false);
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

// Lokasi service menggunakan multiple providers
class LocationService {
  static async getLocationFromIP(ip) {
    try {
      // Coba dengan geoip-lite terlebih dahulu (offline)
      const geo = geoip.lookup(ip);
      if (geo) {
        return {
          ip: ip,
          country: geo.country,
          region: geo.region,
          city: geo.city,
          latitude: geo.ll ? geo.ll[0] : null,
          longitude: geo.ll ? geo.ll[1] : null,
          timezone: geo.timezone,
          source: 'geoip-lite'
        };
      }

      // Fallback ke API online jika geoip-lite gagal
      const response = await axios.get(`http://ip-api.com/json/${ip}`, {
        timeout: 5000
      });

      if (response.data && response.data.status === 'success') {
        return {
          ip: ip,
          country: response.data.country,
          countryCode: response.data.countryCode,
          region: response.data.regionName,
          city: response.data.city,
          latitude: response.data.lat,
          longitude: response.data.lon,
          timezone: response.data.timezone,
          isp: response.data.isp,
          source: 'ip-api'
        };
      }

      return null;
    } catch (error) {
      console.error('Error getting location:', error.message);
      return null;
    }
  }

  static calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    
    const R = 6371; // Radius bumi dalam km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    
    return Math.round(distance);
  }
}

// Media processing utilities
class MediaProcessor {
  static async processImage(inputPath, outputPath, options = {}) {
    try {
      const { width = 1200, height = 800, quality = 80 } = options;
      
      await sharp(inputPath)
        .resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality })
        .toFile(outputPath);
      
      return true;
    } catch (error) {
      console.error('Error processing image:', error);
      return false;
    }
  }

  static getMediaType(mimetype) {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    return 'document';
  }

  static async getFileInfo(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      };
    } catch (error) {
      return null;
    }
  }
}

// Data structures untuk mengelola users dan rooms (Updated)
class ChatManager {
  constructor() {
    this.waitingUsers = [];
    this.activeRooms = new Map();
    this.userSockets = new Map();
  }

  addWaitingUser(socketId, userInfo) {
    this.waitingUsers.push({
      socketId,
      ...userInfo,
      joinedAt: Date.now()
    });
  }

  removeWaitingUser(socketId) {
    this.waitingUsers = this.waitingUsers.filter(user => user.socketId !== socketId);
  }

  findMatch(currentSocketId) {
    const availableUsers = this.waitingUsers.filter(user => user.socketId !== currentSocketId);
    
    if (availableUsers.length > 0) {
      const matchedUser = availableUsers[0];
      
      this.removeWaitingUser(currentSocketId);
      this.removeWaitingUser(matchedUser.socketId);
      
      return matchedUser;
    }
    
    return null;
  }

  createRoom(user1, user2) {
    const roomId = uuidv4();
    
    // Hitung jarak antara user jika ada koordinat
    let distance = null;
    if (user1.location && user2.location) {
      distance = LocationService.calculateDistance(
        user1.location.latitude,
        user1.location.longitude,
        user2.location.latitude,
        user2.location.longitude
      );
    }

    const room = {
      id: roomId,
      user1: user1,
      user2: user2,
      createdAt: Date.now(),
      messages: [],
      distance: distance
    };
    
    this.activeRooms.set(roomId, room);
    return room;
  }

  getRoomBySocketId(socketId) {
    for (let [roomId, room] of this.activeRooms) {
      if (room.user1.socketId === socketId || room.user2.socketId === socketId) {
        return room;
      }
    }
    return null;
  }

  removeRoom(roomId) {
    this.activeRooms.delete(roomId);
  }

  getPartnerSocketId(roomId, currentSocketId) {
    const room = this.activeRooms.get(roomId);
    if (!room) return null;
    
    if (room.user1.socketId === currentSocketId) {
      return room.user2.socketId;
    } else if (room.user2.socketId === currentSocketId) {
      return room.user1.socketId;
    }
    
    return null;
  }

  getPartnerInfo(roomId, currentSocketId) {
    const room = this.activeRooms.get(roomId);
    if (!room) return null;
    
    if (room.user1.socketId === currentSocketId) {
      return room.user2;
    } else if (room.user2.socketId === currentSocketId) {
      return room.user1;
    }
    
    return null;
  }

  addMessageToRoom(roomId, message) {
    const room = this.activeRooms.get(roomId);
    if (room) {
      room.messages.push({
        ...message,
        timestamp: Date.now()
      });
    }
  }
}

const chatManager = new ChatManager();

// Routes
app.get('/', (req, res) => {
  res.send('Anonymous Chat Server with Media & Location is running!');
});

// Upload voice message
app.post('/upload-voice', uploadVoice.single('voice'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No voice file uploaded' });
  }
  
  res.json({
    success: true,
    filename: req.file.filename,
    url: `/uploads/voice/${req.file.filename}`,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

// Upload media files (images, videos, documents)
app.post('/upload-media', uploadMedia.single('media'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No media file uploaded' });
  }

  try {
    const mediaType = MediaProcessor.getMediaType(req.file.mimetype);
    let processedUrl = `/uploads/media/${req.file.filename}`;
    let thumbnailUrl = null;

    // Proses gambar untuk optimasi
    if (mediaType === 'image') {
      const optimizedPath = path.join('uploads/images/', 'opt_' + req.file.filename);
      const thumbnailPath = path.join('uploads/images/', 'thumb_' + req.file.filename);
      
      // Buat versi optimized
      await MediaProcessor.processImage(req.file.path, optimizedPath, {
        width: 1200,
        quality: 85
      });
      
      // Buat thumbnail
      await MediaProcessor.processImage(req.file.path, thumbnailPath, {
        width: 300,
        height: 300,
        quality: 70
      });
      
      processedUrl = `/uploads/images/opt_${req.file.filename}`;
      thumbnailUrl = `/uploads/images/thumb_${req.file.filename}`;
    }

    const fileInfo = await MediaProcessor.getFileInfo(req.file.path);

    res.json({
      success: true,
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: processedUrl,
      thumbnailUrl: thumbnailUrl,
      size: req.file.size,
      mimetype: req.file.mimetype,
      mediaType: mediaType,
      fileInfo: fileInfo
    });

  } catch (error) {
    console.error('Error processing media:', error);
    res.status(500).json({ error: 'Error processing media file' });
  }
});

// Upload image dengan processing
app.post('/upload-image', uploadImage.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file uploaded' });
  }

  try {
    const optimizedPath = path.join('uploads/images/', 'opt_' + req.file.filename);
    const thumbnailPath = path.join('uploads/images/', 'thumb_' + req.file.filename);
    
    // Buat versi optimized
    await MediaProcessor.processImage(req.file.path, optimizedPath);
    
    // Buat thumbnail
    await MediaProcessor.processImage(req.file.path, thumbnailPath, {
      width: 300,
      height: 300
    });

    const fileInfo = await MediaProcessor.getFileInfo(req.file.path);

    res.json({
      success: true,
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: `/uploads/images/opt_${req.file.filename}`,
      thumbnailUrl: `/uploads/images/thumb_${req.file.filename}`,
      originalUrl: `/uploads/images/${req.file.filename}`,
      size: req.file.size,
      mimetype: req.file.mimetype,
      fileInfo: fileInfo
    });

  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ error: 'Error processing image' });
  }
});

// Get user location from IP
app.get('/get-location', async (req, res) => {
  try {
    const clientIP = req.clientIp === '::1' || req.clientIp === '127.0.0.1' 
      ? '8.8.8.8' // Use Google DNS for localhost testing
      : req.clientIp;

    const location = await LocationService.getLocationFromIP(clientIP);
    
    if (location) {
      res.json({
        success: true,
        location: location
      });
    } else {
      res.json({
        success: false,
        message: 'Unable to determine location'
      });
    }
  } catch (error) {
    console.error('Error getting location:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Socket.IO Connection Handler (Updated)
io.on('connection', async (socket) => {
  console.log('User connected:', socket.id);
  
  // Get user location on connection
  const clientIP = socket.handshake.headers['x-forwarded-for'] || 
                   socket.handshake.headers['x-real-ip'] || 
                   socket.handshake.address ||
                   '8.8.8.8'; // Fallback for testing
  
  const userLocation = await LocationService.getLocationFromIP(clientIP);
  
  // User bergabung ke sistem
  socket.on('join-system', (userInfo) => {
    const userWithLocation = {
      ...userInfo,
      socketId: socket.id,
      joinedAt: Date.now(),
      location: userLocation,
      ip: clientIP
    };
    
    chatManager.userSockets.set(socket.id, userWithLocation);
    
    socket.emit('joined-system', {
      success: true,
      socketId: socket.id,
      location: userLocation
    });
  });

  // Cari pasangan chat
  socket.on('find-partner', () => {
    const userInfo = chatManager.userSockets.get(socket.id);
    if (!userInfo) {
      socket.emit('error', { message: 'User not found in system' });
      return;
    }

    const existingRoom = chatManager.getRoomBySocketId(socket.id);
    if (existingRoom) {
      socket.emit('error', { message: 'Already in a chat room' });
      return;
    }

    const match = chatManager.findMatch(socket.id);
    
    if (match) {
      const room = chatManager.createRoom(userInfo, match);
      
      socket.join(room.id);
      io.sockets.sockets.get(match.socketId)?.join(room.id);
      
      // Siapkan info partner dengan lokasi
      const partnerLocationInfo = match.location ? {
        country: match.location.country,
        city: match.location.city,
        region: match.location.region,
        distance: room.distance
      } : null;

      const userLocationInfo = userInfo.location ? {
        country: userInfo.location.country,
        city: userInfo.location.city,
        region: userInfo.location.region,
        distance: room.distance
      } : null;
      
      const roomInfo = {
        roomId: room.id,
        partnerId: match.socketId,
        partnerInfo: {
          nickname: match.nickname || 'Anonymous',
          location: partnerLocationInfo
        }
      };
      
      const partnerRoomInfo = {
        roomId: room.id,
        partnerId: socket.id,
        partnerInfo: {
          nickname: userInfo.nickname || 'Anonymous',
          location: userLocationInfo
        }
      };
      
      socket.emit('partner-found', roomInfo);
      io.to(match.socketId).emit('partner-found', partnerRoomInfo);
      
    } else {
      chatManager.addWaitingUser(socket.id, userInfo);
      socket.emit('searching-partner');
    }
  });

  // Send media message
  socket.on('send-media-message', (data) => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (!room) {
      socket.emit('error', { message: 'Not in any chat room' });
      return;
    }

    const message = {
      id: uuidv4(),
      type: 'media',
      mediaType: data.mediaType,
      content: data.url,
      thumbnailUrl: data.thumbnailUrl,
      filename: data.filename,
      originalName: data.originalName,
      size: data.size,
      mimetype: data.mimetype,
      senderId: socket.id,
      timestamp: Date.now()
    };

    chatManager.addMessageToRoom(room.id, message);
    io.to(room.id).emit('new-message', message);
  });

  // Send text message
  socket.on('send-message', (data) => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (!room) {
      socket.emit('error', { message: 'Not in any chat room' });
      return;
    }

    const message = {
      id: uuidv4(),
      type: 'text',
      content: data.message,
      senderId: socket.id,
      timestamp: Date.now()
    };

    chatManager.addMessageToRoom(room.id, message);
    io.to(room.id).emit('new-message', message);
  });

  // Send voice message
  socket.on('send-voice-message', (data) => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (!room) {
      socket.emit('error', { message: 'Not in any chat room' });
      return;
    }

    const message = {
      id: uuidv4(),
      type: 'voice',
      content: data.audioUrl,
      duration: data.duration || 0,
      size: data.size,
      senderId: socket.id,
      timestamp: Date.now()
    };

    chatManager.addMessageToRoom(room.id, message);
    io.to(room.id).emit('new-message', message);
  });

  // Get partner location
  socket.on('get-partner-location', () => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (!room) {
      socket.emit('error', { message: 'Not in any chat room' });
      return;
    }

    const partnerInfo = chatManager.getPartnerInfo(room.id, socket.id);
    if (partnerInfo && partnerInfo.location) {
      socket.emit('partner-location', {
        location: {
          country: partnerInfo.location.country,
          city: partnerInfo.location.city,
          region: partnerInfo.location.region,
          distance: room.distance
        }
      });
    } else {
      socket.emit('partner-location', {
        location: null,
        message: 'Partner location not available'
      });
    }
  });

  // Stop chat
  socket.on('stop-chat', () => {
    chatManager.removeWaitingUser(socket.id);
    
    const room = chatManager.getRoomBySocketId(socket.id);
    if (room) {
      const partnerSocketId = chatManager.getPartnerSocketId(room.id, socket.id);
      
      if (partnerSocketId) {
        io.to(partnerSocketId).emit('partner-disconnected');
      }
      
      chatManager.removeRoom(room.id);
      socket.leave(room.id);
    }
    
    socket.emit('chat-stopped');
  });

  // Voice call events (sama seperti sebelumnya)
  socket.on('initiate-voice-call', () => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (!room) {
      socket.emit('error', { message: 'Not in any chat room' });
      return;
    }

    const partnerSocketId = chatManager.getPartnerSocketId(room.id, socket.id);
    if (partnerSocketId) {
      io.to(partnerSocketId).emit('incoming-voice-call', {
        callerId: socket.id,
        callerNickname: chatManager.userSockets.get(socket.id)?.nickname || 'Anonymous'
      });
    }
  });

  socket.on('accept-voice-call', (data) => {
    const { callerId } = data;
    io.to(callerId).emit('voice-call-accepted', {
      accepterId: socket.id
    });
  });

  socket.on('reject-voice-call', (data) => {
    const { callerId } = data;
    io.to(callerId).emit('voice-call-rejected', {
      rejecterId: socket.id
    });
  });

  socket.on('end-voice-call', () => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (room) {
      const partnerSocketId = chatManager.getPartnerSocketId(room.id, socket.id);
      if (partnerSocketId) {
        io.to(partnerSocketId).emit('voice-call-ended');
      }
    }
  });

  // Video call events
  socket.on('initiate-video-call', () => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (!room) {
      socket.emit('error', { message: 'Not in any chat room' });
      return;
    }

    const partnerSocketId = chatManager.getPartnerSocketId(room.id, socket.id);
    if (partnerSocketId) {
      io.to(partnerSocketId).emit('incoming-video-call', {
        callerId: socket.id,
        callerNickname: chatManager.userSockets.get(socket.id)?.nickname || 'Anonymous'
      });
    }
  });

  socket.on('accept-video-call', (data) => {
    const { callerId } = data;
    io.to(callerId).emit('video-call-accepted', {
      accepterId: socket.id
    });
  });

  socket.on('reject-video-call', (data) => {
    const { callerId } = data;
    io.to(callerId).emit('video-call-rejected', {
      rejecterId: socket.id
    });
  });

  socket.on('end-video-call', () => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (room) {
      const partnerSocketId = chatManager.getPartnerSocketId(room.id, socket.id);
      if (partnerSocketId) {
        io.to(partnerSocketId).emit('video-call-ended');
      }
    }
  });

  // WebRTC signaling events
  socket.on('webrtc-offer', (data) => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (room) {
      const partnerSocketId = chatManager.getPartnerSocketId(room.id, socket.id);
      if (partnerSocketId) {
        io.to(partnerSocketId).emit('webrtc-offer', {
          offer: data.offer,
          senderId: socket.id
        });
      }
    }
  });

  socket.on('webrtc-answer', (data) => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (room) {
      const partnerSocketId = chatManager.getPartnerSocketId(room.id, socket.id);
      if (partnerSocketId) {
        io.to(partnerSocketId).emit('webrtc-answer', {
          answer: data.answer,
          senderId: socket.id
        });
      }
    }
  });

  socket.on('webrtc-ice-candidate', (data) => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (room) {
      const partnerSocketId = chatManager.getPartnerSocketId(room.id, socket.id);
      if (partnerSocketId) {
        io.to(partnerSocketId).emit('webrtc-ice-candidate', {
          candidate: data.candidate,
          senderId: socket.id
        });
      }
    }
  });

  // Typing indicator
  socket.on('typing-start', () => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (room) {
      const partnerSocketId = chatManager.getPartnerSocketId(room.id, socket.id);
      if (partnerSocketId) {
        io.to(partnerSocketId).emit('partner-typing-start');
      }
    }
  });

  socket.on('typing-stop', () => {
    const room = chatManager.getRoomBySocketId(socket.id);
    if (room) {
      const partnerSocketId = chatManager.getPartnerSocketId(room.id, socket.id);
      if (partnerSocketId) {
        io.to(partnerSocketId).emit('partner-typing-stop');
      }
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    chatManager.removeWaitingUser(socket.id);
    chatManager.userSockets.delete(socket.id);
    
    const room = chatManager.getRoomBySocketId(socket.id);
    if (room) {
      const partnerSocketId = chatManager.getPartnerSocketId(room.id, socket.id);
      
      if (partnerSocketId) {
        io.to(partnerSocketId).emit('partner-disconnected');
      }
      
      chatManager.removeRoom(room.id);
    }
  });
});

// Create necessary directories
const createDirectories = () => {
  const directories = [
    'uploads/voice',
    'uploads/media',
    'uploads/images',
    'uploads/videos',
    'uploads/documents'
  ];

  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

createDirectories();

const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready for connections`);
  console.log(`Media upload endpoints available`);
  console.log(`Location service enabled`);
});
