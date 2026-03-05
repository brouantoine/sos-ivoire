const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

// Inscription utilisateur
router.post('/register', async (req, res) => {
  const { nom, prenom, telephone, mot_de_passe, blood_type, age, notes_medicales } = req.body;
  try {
    const hash = await bcrypt.hash(mot_de_passe, 10);
    const result = await db.query(
      `INSERT INTO users (nom, prenom, telephone, mot_de_passe, blood_type, age, notes_medicales)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, nom, prenom, telephone`,
      [nom, prenom, telephone, hash, blood_type, age, notes_medicales]
    );
    res.status(201).json({ message: 'Compte créé avec succès', user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Connexion utilisateur
router.post('/login', async (req, res) => {
  const { telephone, mot_de_passe } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE telephone = $1', [telephone]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
    if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect' });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, nom: user.nom, prenom: user.prenom } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Récupérer le profil
router.get('/profil/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nom, prenom, telephone, blood_type, age, notes_medicales,
       type_assurance, numero_assurance, compagnie_assurance,
       numero_piece, type_piece, allergies, medicaments,
       contact_urgence_nom, contact_urgence_telephone, contact_urgence_lien,
       created_at FROM users WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modifier le profil
router.put('/profil/:id', async (req, res) => {
  const {
    nom, prenom, telephone, blood_type, age, notes_medicales,
    type_assurance, numero_assurance, compagnie_assurance,
    numero_piece, type_piece, allergies, medicaments,
    contact_urgence_nom, contact_urgence_telephone, contact_urgence_lien
  } = req.body;
  try {
    const result = await db.query(
      `UPDATE users SET nom=$1, prenom=$2, telephone=$3, blood_type=$4, age=$5,
       notes_medicales=$6, type_assurance=$7, numero_assurance=$8,
       compagnie_assurance=$9, numero_piece=$10, type_piece=$11,
       allergies=$12, medicaments=$13,
       contact_urgence_nom=$14, contact_urgence_telephone=$15, contact_urgence_lien=$16
       WHERE id=$17 RETURNING *`,
      [nom, prenom, telephone, blood_type, age, notes_medicales,
       type_assurance, numero_assurance, compagnie_assurance,
       numero_piece, type_piece, allergies, medicaments,
       contact_urgence_nom, contact_urgence_telephone, contact_urgence_lien,
       req.params.id]
    );
    res.json({ message: 'Profil mis à jour', user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;