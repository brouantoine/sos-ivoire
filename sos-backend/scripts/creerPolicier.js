const bcrypt = require('bcrypt');
const db = require('../db');

async function creerPolicier() {
  const hash = await bcrypt.hash('password', 10);
  
  await db.query(`DELETE FROM policiers WHERE badge = 'P001'`);
  
  const result = await db.query(
    `INSERT INTO policiers (nom, prenom, badge, telephone, commissariat_id, mot_de_passe)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    ['Kouassi', 'Jean', 'P001', '+22507000001', 1, hash]
  );
  
  console.log('Policier créé :', result.rows[0]);
  process.exit(0);
}

creerPolicier().catch(console.error);