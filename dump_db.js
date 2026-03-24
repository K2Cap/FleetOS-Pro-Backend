const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'fleetos',
    password: process.env.PGPASSWORD || 'postgres',
    port: process.env.PGPORT || 5432,
});

async function dump() {
    try {
        console.log("--- TRUCKS ---");
        const trucks = await pool.query('SELECT id, reg_no, doc_rc_path, doc_insurance_path FROM trucks LIMIT 5');
        console.table(trucks.rows);

        console.log("\n--- DRIVERS ---");
        const drivers = await pool.query('SELECT id, full_name, doc_dl_path FROM drivers LIMIT 5');
        console.table(drivers.rows);

        console.log("\n--- UPLOADS DIR ---");
        const fs = require('fs');
        const path = require('path');
        const uploads = fs.readdirSync(path.join(__dirname, 'uploads'));
        console.log(uploads);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

dump();
