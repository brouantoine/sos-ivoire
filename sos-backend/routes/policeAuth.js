const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

const OPERATEURS = {
  orange: ['07','27','08','28','57','58'],
  mtn:    ['05','25','04','24','54','55'],
  moov:   ['01','21','02','22','40','41'],
};

const detecterOperateur = (tel) => {
  const clean = tel.replace(/\D/g, '');
  const prefix = clean.startsWith('225') ? clean.substring(3,5) : clean.substring(0,2);
  for (const [op, prefixes] of Object.entries(OPERATEURS)) {
    if (prefixes.includes(prefix)) return op;
  }
  return null;
};

// POST /api/police-auth/register
router.post('/register', async (req, res) => {
  const {
    nom, prenom, badge, grade, telephone,
    telephone_orange, telephone_mtn, telephone_moov,
    commissariat_id, mot_de_passe
  } = req.body;

  if (!nom || !prenom || !badge || !grade || !telephone || !mot_de_passe) {
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  }

  try {
    // Vérifier badge unique
    const exist = await db.query('SELECT id FROM policiers WHERE badge = $1', [badge]);
    if (exist.rows.length > 0)
      return res.status(409).json({ error: 'Ce numéro de badge existe déjà' });

    const hash = await bcrypt.hash(mot_de_passe, 10);
    const operateur = detecterOperateur(telephone);

    const result = await db.query(
      `INSERT INTO policiers
       (nom, prenom, badge, grade, telephone, telephone_orange, telephone_mtn,
        telephone_moov, operateur, commissariat_id, mot_de_passe)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, nom, prenom, badge, grade, telephone, commissariat_id, operateur`,
      [nom, prenom, badge, grade, telephone,
       telephone_orange || null, telephone_mtn || null, telephone_moov || null,
       operateur, commissariat_id || null, hash]
    );

    const policier = result.rows[0];
    const token = jwt.sign({ id: policier.id, role: 'policier' }, process.env.JWT_SECRET, { expiresIn: '30d' });

    // Récupérer infos commissariat
    let commissariat = null;
    if (policier.commissariat_id) {
      const c = await db.query('SELECT nom FROM commissariats WHERE id = $1', [policier.commissariat_id]);
      commissariat = c.rows[0];
    }

    res.status(201).json({ token, policier: { ...policier, commissariat } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/police-auth/login
router.post('/login', async (req, res) => {
  const { badge, mot_de_passe } = req.body;
  if (!badge || !mot_de_passe)
    return res.status(400).json({ error: 'Badge et mot de passe requis' });

  try {
    const result = await db.query(
      `SELECT p.*, c.nom AS commissariat_nom
       FROM policiers p
       LEFT JOIN commissariats c ON p.commissariat_id = c.id
       WHERE p.badge = $1`,
      [badge]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Badge non trouvé' });

    const policier = result.rows[0];
    if (policier.statut !== 'actif')
      return res.status(403).json({ error: 'Compte désactivé' });

    const valid = await bcrypt.compare(mot_de_passe, policier.mot_de_passe);
    if (!valid)
      return res.status(401).json({ error: 'Mot de passe incorrect' });

    const token = jwt.sign({ id: policier.id, role: 'policier' }, process.env.JWT_SECRET, { expiresIn: '30d' });

    const { mot_de_passe: _, ...policierSafe } = policier;
    res.json({ token, policier: policierSafe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/police-auth/profil/:id
router.get('/profil/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.id, p.nom, p.prenom, p.badge, p.grade, p.telephone,
       p.telephone_orange, p.telephone_mtn, p.telephone_moov,
       p.operateur, p.commissariat_id, p.photo_url, p.statut, p.created_at,
       c.nom AS commissariat_nom
       FROM policiers p
       LEFT JOIN commissariats c ON p.commissariat_id = c.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Policier non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/police-auth/commissariats
router.get('/commissariats', async (req, res) => {
  try {
    const result = await db.query('SELECT id, nom FROM commissariats ORDER BY nom');
    res.json({ commissariats: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;