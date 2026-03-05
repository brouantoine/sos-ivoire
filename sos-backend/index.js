const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
require('dotenv').config();
const db = require('./db');
const authRoutes = require('./routes/auth');
const alertesRoutes = require('./routes/alertes');
const policeRoutes = require('./routes/police');
const smsRoutes = require('./routes/sms');
const policeAuthRoutes = require('./routes/policeAuth');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// ─── ATTACHER SOCKET.IO À TOUTES LES ROUTES ──────────────────
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ─── ROUTES ──────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/alertes', alertesRoutes);
app.use('/api/police', policeRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/police-auth', policeAuthRoutes);

// ─── SOCKET.IO ───────────────────────────────────────────────
const policiersConnectes = {};

io.on('connection', (socket) => {
  console.log('Nouveau client connecté:', socket.id);

  socket.on('policier_connecte', (data) => {
    policiersConnectes[socket.id] = data;
    socket.join('police_room');
    console.log(`Policier connecté: ${data.nom}`);
  });

  socket.on('nouvelle_alerte', (data) => {
    console.log('Nouvelle alerte SOS:', data);
    io.to('police_room').emit('alerte_recue', {
      alerte_id: data.alerte_id,
      user: data.user,
      location: data.location,
      commissariat: data.commissariat,
      timestamp: new Date()
    });
  });

  socket.on('update_localisation', (data) => {
    io.to('police_room').emit('position_mise_a_jour', {
      alerte_id: data.alerte_id,
      latitude: data.latitude,
      longitude: data.longitude,
      timestamp: new Date()
    });
  });

  socket.on('annuler_alerte', (data) => {
    io.to('police_room').emit('alerte_annulee', {
      alerte_id: data.alerte_id,
      timestamp: new Date()
    });
  });

  socket.on('disconnect', () => {
    delete policiersConnectes[socket.id];
    console.log('Client déconnecté:', socket.id);
  });
});

// ─── DÉMARRAGE ───────────────────────────────────────────────
server.listen(process.env.PORT || 3000, () => {
  console.log(`Serveur démarré sur le port ${process.env.PORT || 3000}`);
});