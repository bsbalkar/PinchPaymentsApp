// ============================================
// migrate.js
// PURPOSE: Add missing columns to database
// ============================================

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'receipts.db');
const db = new sqlite3.Database(dbPath);

console.log('🔄 Running database migration...');

db.serialize(() => {
    // Add pdf_url column if it doesn't exist
    db.run(`ALTER TABLE receipts ADD COLUMN pdf_url TEXT`, (err) => {
        if (err) {
            if (err.message.includes('duplicate column name')) {
                console.log('✅ pdf_url column already exists');
            } else {
                console.error('❌ Error adding pdf_url:', err.message);
            }
        } else {
            console.log('✅ Added pdf_url column');
        }
    });

    // Add updated_at column if it doesn't exist
    db.run(`ALTER TABLE receipts ADD COLUMN updated_at DATETIME`, (err) => {
        if (err) {
            if (err.message.includes('duplicate column name')) {
                console.log('✅ updated_at column already exists');
            } else {
                console.error('❌ Error adding updated_at:', err.message);
            }
        } else {
            console.log('✅ Added updated_at column');
        }
    });
});

// Close the database
db.close((err) => {
    if (err) {
        console.error('❌ Error closing database:', err.message);
    } else {
        console.log('✅ Migration complete!');
    }
});