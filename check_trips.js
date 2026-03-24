const { Pool } = require('pg');
const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'fleetos',
    password: process.env.PGPASSWORD || 'kartik',
    port: process.env.PGPORT || 5432,
});

async function check() {
    try {
        const res = await pool.query('SELECT id, driver_text, start_date FROM trips');
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
check();
