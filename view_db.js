const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'fleet.db');
const db = new sqlite3.Database(dbPath);

console.log('--- TABLES ---');
db.all("SELECT name FROM sqlite_master WHERE type='table';", (err, tables) => {
    if (err) return console.error(err);
    tables.forEach(t => console.log(`- ${t.name}`));

    console.log('\n--- SCHEMA (trucks) ---');
    db.all("PRAGMA table_info(trucks);", (err, cols) => {
        if (err) return console.error(err);
        cols.forEach(c => console.log(`${c.name} (${c.type})`));

        console.log('\n--- DATA (Last 5) ---');
        db.all("SELECT * FROM trucks ORDER BY id DESC LIMIT 5;", (err, rows) => {
            if (err) return console.error(err);
            console.log(JSON.stringify(rows, null, 2));
            db.close();
        });
    });
});
