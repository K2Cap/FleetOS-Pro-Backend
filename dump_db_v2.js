require('dotenv').config();
const { Pool } = require('pg');
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
        const trucks = await pool.query('SELECT reg_no, doc_rc_path FROM trucks');
        console.table(trucks.rows);

        console.log("\n--- DRIVERS ---");
        const drivers = await pool.query('SELECT full_name, doc_dl_path FROM drivers');
        console.table(drivers.rows);

        console.log("\n--- TRIPS ---");
        const trips = await pool.query('SELECT id, truck_text FROM trips LIMIT 10');
        console.table(trips.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
dump();
