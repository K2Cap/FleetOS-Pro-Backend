const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: 'localhost', database: 'fleetos', password: 'kartik', port: 5432 });

async function seed() {
    try {
        console.log("Resetting and Seeding database...");
        
        // Use TRUNCATE to clear tables
        await pool.query('TRUNCATE drivers, trips, expenses, trucks RESTART IDENTITY CASCADE;');

        // 1. Add Driver Kartik Soni as ID 1
        await pool.query(`
            INSERT INTO drivers (id, full_name, phone, status, join_date)
            VALUES (1, 'Kartik Soni', '9876543210', 'Active', '2026-01-15')
        `);

        // 2. Add some Trucks
        await pool.query(`
            INSERT INTO trucks (reg_no, model, owner_name, status)
            VALUES 
            ('MH 12 AB 1234', 'Tata Prima', 'Kartik Logistics', 'Active'),
            ('DL 01 CD 5678', 'Ashok Leyland', 'Kartik Logistics', 'On Trip')
        `);

        // 3. Add some Trips
        await pool.query(`
            INSERT INTO trips (id, truck_text, origin, destination, start_date, start_date_raw, freight, advance, status, driver_text)
            VALUES 
            ('TRIP-001', 'MH 12 AB 1234', 'Mumbai', 'Pune', '19 Mar', '${new Date().toISOString()}', 45000, 5000, 'Active', 'Kartik Soni'),
            ('TRIP-002', 'DL 01 CD 5678', 'Delhi', 'Jaipur', '18 Mar', '${new Date(Date.now() - 86400000).toISOString()}', 32000, 10000, 'Completed', 'Kartik Soni')
        `);

        // 4. Add some Expenses
        await pool.query(`
            INSERT INTO expenses (merchant, category, amount, total, date, status, driver_id, truck_id)
            VALUES 
            ('HP Petrol Pump', 'Fuel', 12500, 12500, '2026-03-19', 'Approved', '1', 'MH 12 AB 1234'),
            ('Sharma Dhaba', 'Food', 450, 450, '2026-03-19', 'Approved', '1', 'MH 12 AB 1234'),
            ('Toll Plaza', 'Toll', 1200, 1200, '2026-03-18', 'Approved', '1', 'DL 01 CD 5678')
        `);

        console.log("Database seeded successfully with clean data.");
    } catch (e) {
        console.error("Seeding failed:", e);
    } finally {
        await pool.end();
    }
}

seed();
