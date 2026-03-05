const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/alertes/commissariats - téléchargement au démarrage de l'app
router.get('/commissariats', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, nom, zone,
        ST_X(localisation::geometry) AS longitude,
        ST_Y(localisation::geometry) AS latitude,
        telephone_orange, telephone_mtn, telephone_moov
      FROM commissariats
    `);
    res.json({ commissariats: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alertes/sos — Déclencher une alerte SOS
router.post('/sos', async (req, res) => {
  const { user_id, latitude, longitude, mode_envoi, alerte_id_origine } = req.body;
  try {

    // ─── ANTI-DOUBLON ─────────────────────────────────────────
    // Si l'alerte vient d'un rétablissement réseau, vérifier si elle existe déjà
    if (alerte_id_origine) {
      const exist = await db.query(
        `SELECT id FROM alertes WHERE alerte_id_origine = $1`,
        [alerte_id_origine]
      );
      if (exist.rows.length > 0) {
        console.log('[ANTI-DOUBLON] Alerte déjà enregistrée:', alerte_id_origine);
        return res.json({ 
          alerte_id: exist.rows[0].id, 
          doublon: true,
          message: 'Alerte déjà enregistrée'
        });
      }
    }

    // Trouver le commissariat le plus proche avec PostGIS
    const commissariat = await db.query(
      `SELECT id, nom, telephone,
       ST_Distance(localisation, ST_MakePoint($1, $2)::geography) AS distance
       FROM commissariats
       ORDER BY distance ASC
       LIMIT 1`,
      [longitude, latitude]
    );

    if (commissariat.rows.length === 0) {
      return res.status(404).json({ error: 'Aucun commissariat trouvé' });
    }

    const commissariat_id = commissariat.rows[0].id;

    // Créer l'alerte avec alerte_id_origine pour tracking anti-doublon
    const alerte = await db.query(
      `INSERT INTO alertes (user_id, commissariat_id, mode_envoi, alerte_id_origine)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [user_id, commissariat_id, mode_envoi || 'internet', alerte_id_origine || null]
    );

    const alerte_id = alerte.rows[0].id;

    // Sauvegarder la position initiale
    await db.query(
      `INSERT INTO localisations (alerte_id, latitude, longitude)
       VALUES ($1, $2, $3)`,
      [alerte_id, latitude, longitude]
    );

    // Notifier police via Socket.IO
    const userResult = await db.query(
      `SELECT nom, prenom, telephone, blood_type FROM users WHERE id = $1`,
      [user_id]
    );

    req.io.to('police_room').emit('alerte_recue', {
      alerte_id,
      user: userResult.rows[0],
      location: { latitude, longitude },
      commissariat: commissariat.rows[0],
      mode: mode_envoi || 'internet',
      timestamp: new Date()
    });

    res.status(201).json({
      message: 'Alerte envoyée !',
      alerte_id,
      commissariat: commissariat.rows[0]
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alertes/localisation — Mettre à jour la position GPS en temps réel
router.post('/localisation', async (req, res) => {
  const { alerte_id, latitude, longitude } = req.body;
  try {
    await db.query(
      `INSERT INTO localisations (alerte_id, latitude, longitude) VALUES ($1, $2, $3)`,
      [alerte_id, latitude, longitude]
    );
    res.json({ message: 'Position mise à jour' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alertes/historique/:user_id — Historique des alertes
router.get('/historique/:user_id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.id, a.statut, a.mode_envoi, a.created_at,
       c.nom as commissariat_nom, c.zone as commissariat_zone,
       l.latitude, l.longitude
       FROM alertes a
       LEFT JOIN commissariats c ON a.commissariat_id = c.id
       LEFT JOIN localisations l ON l.alerte_id = a.id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC`,
      [req.params.user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alertes/sos-mesh — Alerte reçue via réseau mesh
router.post('/sos-mesh', async (req, res) => {
  const { user_id, latitude, longitude, hop_count, alerte_id_mesh, timestamp_origine } = req.body;
  
  try {
    // ─── ANTI-DOUBLON MESH ────────────────────────────────────
    // Vérifier si cette alerte mesh a déjà été reçue
    if (alerte_id_mesh) {
      const exist = await db.query(
        `SELECT id FROM alertes WHERE alerte_id_origine = $1`,
        [alerte_id_mesh]
      );
      if (exist.rows.length > 0) {
        console.log('[ANTI-DOUBLON MESH] Alerte mesh déjà enregistrée:', alerte_id_mesh);
        return res.json({ 
          success: true,
          alerte_id: exist.rows[0].id,
          doublon: true 
        });
      }
    }

    // Trouver commissariat le plus proche
    const commissariat = await db.query(
      `SELECT id, nom,
       ST_Distance(localisation, ST_MakePoint($1,$2)::geography) AS distance
       FROM commissariats ORDER BY distance ASC LIMIT 1`,
      [longitude, latitude]
    );

    // Créer l'alerte avec alerte_id_origine = alerte_id_mesh
    const alerte = await db.query(
      `INSERT INTO alertes (user_id, commissariat_id, mode_envoi, alerte_id_origine)
       VALUES ($1, $2, 'mesh', $3) RETURNING id`,
      [user_id, commissariat.rows[0]?.id, alerte_id_mesh || null]
    );

    // Enregistrer position
    await db.query(
      `INSERT INTO localisations (alerte_id, latitude, longitude) VALUES ($1, $2, $3)`,
      [alerte.rows[0].id, latitude, longitude]
    );

    // Récupérer infos victime
    const userResult = await db.query(
      `SELECT nom, prenom, telephone, blood_type FROM users WHERE id = $1`,
      [user_id]
    );

    // Notifier police via Socket.IO
    req.io.to('police_room').emit('alerte_recue', {
      alerte_id: alerte.rows[0].id,
      user: userResult.rows[0],
      location: { latitude, longitude },
      commissariat: commissariat.rows[0],
      mode: 'mesh',
      hop_count,
      timestamp: timestamp_origine
    });

    console.log(`[MESH] ✅ Alerte reçue via ${hop_count} relais — police notifiée`);
    res.json({ success: true, alerte_id: alerte.rows[0].id });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;