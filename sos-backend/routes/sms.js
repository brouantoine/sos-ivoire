// const express = require('express');
// const router = express.Router();
// const db = require('../db');

// const AfricasTalking = require('africastalking');

// const africas = AfricasTalking({
//   apiKey: process.env.AT_API_KEY,
//   username: process.env.AT_USERNAME
// });

// const sms = africas.SMS;

// router.post('/envoyer', async (req, res) => {
//   const { user_id, latitude, longitude } = req.body;

//   try {
//     const userResult = await db.query(
//       `SELECT nom, prenom, telephone, blood_type, allergies,
//        contact_urgence_nom, contact_urgence_telephone
//        FROM users WHERE id = $1`,
//       [user_id]
//     );

//     if (userResult.rows.length === 0)
//       return res.status(404).json({ error: 'Utilisateur non trouvé' });

//     const user = userResult.rows[0];

//     const commissariat = await db.query(
//       `SELECT id, nom, telephone,
//        ST_Distance(localisation, ST_MakePoint($1, $2)::geography) AS distance
//        FROM commissariats ORDER BY distance ASC LIMIT 1`,
//       [longitude, latitude]
//     );

//     const message = `🚨 ALERTE SOS - SOS Ivoire
// Victime: ${user.prenom} ${user.nom}
// Tel: ${user.telephone}
// Position: ${latitude}, ${longitude}
// Maps: https://maps.google.com/?q=${latitude},${longitude}
// Sang: ${user.blood_type || 'Non renseigné'}
// Allergies: ${user.allergies || 'Aucune'}
// Contact urgence: ${user.contact_urgence_nom || '-'} (${user.contact_urgence_telephone || '-'})
// Commissariat: ${commissariat.rows[0]?.nom || 'Non trouvé'}`;

//     // Envoi via AfricasTalking
//     const result = await sms.send({
//       to: [process.env.NUMERO_RECEPTION_SOS],
//       message: message,
//       from: process.env.AT_SENDER_ID  // Ton sender ID alphanumérique ex: "SOSIvoire"
//     });

//     console.log('[SMS AfricasTalking]', JSON.stringify(result));

//     // Enregistrer en BDD
//     const alerte = await db.query(
//       `INSERT INTO alertes (user_id, commissariat_id, mode_envoi)
//        VALUES ($1, $2, 'sms') RETURNING id`,
//       [user_id, commissariat.rows[0]?.id || null]
//     );

//     await db.query(
//       `INSERT INTO localisations (alerte_id, latitude, longitude)
//        VALUES ($1, $2, $3)`,
//       [alerte.rows[0].id, latitude, longitude]
//     );

//     res.json({ message: 'SMS envoyé avec succès', alerte_id: alerte.rows[0].id });

//   } catch (err) {
//     console.error('Erreur SMS AfricasTalking:', err);
//     res.status(500).json({ error: err.message });
//   }
// });

// module.exports = router;












const express = require('express');
const router = express.Router();
const db = require('../db');
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

router.post('/envoyer', async (req, res) => {
  const { user_id, latitude, longitude } = req.body;
  try {
    const userResult = await db.query(
      `SELECT nom, prenom, telephone, blood_type, allergies,
       contact_urgence_nom, contact_urgence_telephone
       FROM users WHERE id = $1`,
      [user_id]
    );
    if (userResult.rows.length === 0)
      return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const user = userResult.rows[0];

    const commissariat = await db.query(
      `SELECT id, nom,
       ST_Distance(localisation, ST_MakePoint($1, $2)::geography) AS distance
       FROM commissariats ORDER BY distance ASC LIMIT 1`,
      [longitude, latitude]
    );

    const message = `ALERTE SOS - SOS Ivoire
Victime: ${user.prenom} ${user.nom}
Tel: ${user.telephone}
Position: ${latitude}, ${longitude}
Maps: https://maps.google.com/?q=${latitude},${longitude}
Sang: ${user.blood_type || 'Non renseigne'}
Allergies: ${user.allergies || 'Aucune'}
Contact urgence: ${user.contact_urgence_nom || '-'} (${user.contact_urgence_telephone || '-'})
Commissariat: ${commissariat.rows[0]?.nom || 'Non trouve'}`;

    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.NUMERO_RECEPTION_SOS
    });

    console.log('[SMS Twilio] Envoyé avec succès');

    const alerte = await db.query(
      `INSERT INTO alertes (user_id, commissariat_id, mode_envoi)
       VALUES ($1, $2, 'sms') RETURNING id`,
      [user_id, commissariat.rows[0]?.id || null]
    );

    await db.query(
      `INSERT INTO localisations (alerte_id, latitude, longitude)
       VALUES ($1, $2, $3)`,
      [alerte.rows[0].id, latitude, longitude]
    );

    res.json({ message: 'SMS envoyé', alerte_id: alerte.rows[0].id });
  } catch (err) {
    console.error('Erreur SMS:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Webhook Twilio — reçoit les SMS entrants de la victime
router.post('/webhook', async (req, res) => {
  try {
    const { Body, From } = req.body;
    console.log('[WEBHOOK SMS reçu]', Body, 'de', From);

    // Parser le message : SOS|user_id|latitude|longitude
    const parts = Body.trim().split('|');
    if (parts[0] !== 'SOS' || parts.length < 4) {
      return res.status(200).send('<Response/>');
    }

    const user_id = parseInt(parts[1]);
    const latitude = parseFloat(parts[2]);
    const longitude = parseFloat(parts[3]);

    // Trouver le commissariat le plus proche
    const commissariat = await db.query(
      `SELECT id, nom,
       ST_Distance(localisation, ST_MakePoint($1, $2)::geography) AS distance
       FROM commissariats ORDER BY distance ASC LIMIT 1`,
      [longitude, latitude]
    );

    // Créer l'alerte en BDD
    const alerte = await db.query(
      `INSERT INTO alertes (user_id, commissariat_id, mode_envoi)
       VALUES ($1, $2, 'sms') RETURNING id`,
      [user_id, commissariat.rows[0]?.id || null]
    );

    await db.query(
      `INSERT INTO localisations (alerte_id, latitude, longitude)
       VALUES ($1, $2, $3)`,
      [alerte.rows[0].id, latitude, longitude]
    );

    // Récupérer infos victime
    const userResult = await db.query(
      `SELECT nom, prenom, telephone, blood_type, allergies FROM users WHERE id = $1`,
      [user_id]
    );

    // Notifier la police via Socket.IO
    // On a besoin d'accès à io ici — on va le passer en paramètre
    req.io.to('police_room').emit('alerte_recue', {
      alerte_id: alerte.rows[0].id,
      user: userResult.rows[0],
      location: { latitude, longitude },
      commissariat: commissariat.rows[0],
      timestamp: new Date(),
      mode: 'sms'
    });

    console.log('[WEBHOOK] Alerte créée et police notifiée');
    res.status(200).send('<Response/>');

  } catch (err) {
    console.error('[WEBHOOK] Erreur:', err.message);
    res.status(200).send('<Response/>');
  }
});


module.exports = router;