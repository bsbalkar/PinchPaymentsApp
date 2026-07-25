// ============================================
// database/setup.js
// PURPOSE: Create SQLite3 database and tables
// ============================================

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Ensure the database directory exists
const fs = require('fs');
const dbDir = path.join(__dirname);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Database file path
const dbPath = path.join(dbDir, 'receipts.db');

// Create or open the database
const db = new sqlite3.Database(dbPath);

// ----- Create tables -----
// Table 1: receipts — stores all payment and receipt data
// Table 2: payers — stores customer information

db.serialize(() => {
    // --- Receipts table ---
    db.run(`
        CREATE TABLE IF NOT EXISTS receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pinch_payment_id TEXT UNIQUE NOT NULL,
            payer_id TEXT NOT NULL,
            customer_email TEXT NOT NULL,
            customer_name TEXT,
            amount INTEGER NOT NULL,          -- in cents
            currency TEXT DEFAULT 'AUD',
            invoice_number TEXT,
            reference TEXT,
            receipt_text TEXT,                 -- full receipt as text
            pdf_path TEXT,                     -- local path to PDF
            status TEXT DEFAULT 'pending',     -- pending, generated, sent
            webhook_received_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME
        )
    `);

    // --- Payers table (cached customer data) ---
    db.run(`
        CREATE TABLE IF NOT EXISTS payers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pinch_payer_id TEXT UNIQUE NOT NULL,
            email TEXT NOT NULL,
            first_name TEXT,
            last_name TEXT,
            phone TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME
        )
    `);

    // --- Indexes for faster lookups ---
    db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_payment_id ON receipts(pinch_payment_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_email ON receipts(customer_email)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_payers_email ON payers(email)`);

    console.log('✅ Database created at:', dbPath);
    console.log('📋 Tables: receipts, payers');
});

// Close the database connection
db.close((err) => {
    if (err) {
        console.error('❌ Error closing database:', err.message);
    } else {
        console.log('✅ Database setup complete!');
    }
});