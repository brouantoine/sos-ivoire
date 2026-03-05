const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

// Connexion policier
router.post('/login', async (req, res) => {
  const { badge, mot_de_passe } = req.body;
  try {
    const result = await db.query(
      'SELECT * FROM policiers WHERE badge = $1',
      [badge]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Badge non trouvé' });

    const policier = result.rows[0];
    const valid = await bcrypt.compare(mot_de_passe, policier.mot_de_passe);
    if (!valid)
      return res.status(401).json({ error: 'Mot de passe incorrect' });

    const token = jwt.sign({ id: policier.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      policier: {
        id: policier.id,
        nom: policier.nom,
        prenom: policier.prenom,
        badge: policier.badge,
        commissariat_id: policier.commissariat_id
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alertes actives pour un commissariat
router.get('/alertes/:commissariat_id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.id, a.statut, a.mode_envoi, a.created_at,
       u.nom, u.prenom, u.telephone, u.blood_type, u.age,
       u.allergies, u.medicaments, u.notes_medicales,
       u.type_piece, u.numero_piece,
       u.contact_urgence_nom, u.contact_urgence_telephone, u.contact_urgence_lien,
       u.compagnie_assurance, u.numero_assurance,
       l.latitude, l.longitude, l.timestamp as derniere_position
       FROM alertes a
       JOIN users u ON a.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, timestamp
         FROM localisations
         WHERE alerte_id = a.id
         ORDER BY timestamp DESC
         LIMIT 1
       ) l ON true
       WHERE a.commissariat_id = $1 AND a.statut = 'active'
       ORDER BY a.created_at DESC`,
      [req.params.commissariat_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Résoudre une alerte
router.put('/alertes/:id/resoudre', async (req, res) => {
  try {
    await db.query(
      `UPDATE alertes SET statut = 'annulee' WHERE id = $1`,
      [req.params.id]
    );
    res.json({ message: 'Alerte résolue' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;