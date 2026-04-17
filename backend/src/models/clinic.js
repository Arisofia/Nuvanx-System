'use strict';

const { pool, isAvailable } = require('../db');

const clinicModel = {
  async create({ name, slug, timezone = 'America/New_York', metadata = {} }) {
    if (!isAvailable()) return null;
    const { rows } = await pool.query(
      `INSERT INTO clinics (name, slug, timezone, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, slug, timezone, JSON.stringify(metadata)]
    );
    return rows[0] || null;
  },

  async getById(id) {
    if (!isAvailable()) return null;
    const { rows } = await pool.query('SELECT * FROM clinics WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async getBySlug(slug) {
    if (!isAvailable()) return null;
    const { rows } = await pool.query('SELECT * FROM clinics WHERE slug = $1', [slug]);
    return rows[0] || null;
  },

  async update(id, fields) {
    if (!isAvailable()) return null;
    const allowed = ['name', 'slug', 'timezone', 'metadata'];
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = $${idx}`);
        vals.push(key === 'metadata' ? JSON.stringify(fields[key]) : fields[key]);
        idx++;
      }
    }
    if (sets.length === 0) return null;
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE clinics SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
      vals
    );
    return rows[0] || null;
  },

  async assignUser(userId, clinicId) {
    if (!isAvailable()) return false;
    const { rowCount } = await pool.query(
      'UPDATE users SET clinic_id = $1, updated_at = NOW() WHERE id = $2',
      [clinicId, userId]
    );
    return rowCount > 0;
  },
};

module.exports = clinicModel;
