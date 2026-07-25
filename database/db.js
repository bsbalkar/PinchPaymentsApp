// ============================================
// database/db.js
// PURPOSE: Database helper functions
// ============================================

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'receipts.db');
const db = new sqlite3.Database(dbPath);

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// ----- Helper: Run a query and get a single row -----
function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// ----- Helper: Run a query and get all rows -----
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// ----- Helper: Run a query that doesn't return data -----
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

// ----- Save a receipt from a webhook payload -----
async function saveReceiptFromWebhook(paymentData) {
    const { 
        id: pinch_payment_id,
        payerId,
        amount,
        currency = 'AUD',
        reference,
        metadata = {},
        payer
    } = paymentData;

    const emailAddress = payer?.emailAddress || metadata?.customer_email || 'unknown@example.com';
    const firstName = payer?.firstName || metadata?.first_name || 'Customer';
    const lastName = payer?.lastName || metadata?.last_name || '';

    // Save or update payer first
    await savePayer(payerId, emailAddress, firstName, lastName);

    // Generate receipt text
    const receiptText = generateReceiptText({
        paymentId: pinch_payment_id,
        amount,
        currency,
        reference,
        customerName: `${firstName} ${lastName}`.trim(),
        customerEmail: emailAddress
    });

    const result = await run(`
        INSERT OR REPLACE INTO receipts (
            pinch_payment_id,
            payer_id,
            customer_email,
            customer_name,
            amount,
            currency,
            reference,
            receipt_text,
            status,
            webhook_received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
        pinch_payment_id,
        payerId,
        emailAddress,
        `${firstName} ${lastName}`.trim() || 'Customer',
        amount,
        currency,
        reference || `PAY-${Date.now()}`,
        receiptText,
        'pending'
    ]);

    return { ...result, receiptText };
}

// ----- Save or update a payer -----
async function savePayer(pinch_payer_id, email, firstName, lastName, phone = null) {
    const existing = await get(
        'SELECT id FROM payers WHERE pinch_payer_id = ?',
        [pinch_payer_id]
    );

    if (existing) {
        await run(`
            UPDATE payers 
            SET email = ?, first_name = ?, last_name = ?, phone = ?, updated_at = datetime('now')
            WHERE pinch_payer_id = ?
        `, [email, firstName, lastName, phone, pinch_payer_id]);
        return { updated: true, id: existing.id };
    } else {
        const result = await run(`
            INSERT INTO payers (pinch_payer_id, email, first_name, last_name, phone)
            VALUES (?, ?, ?, ?, ?)
        `, [pinch_payer_id, email, firstName, lastName, phone]);
        return { updated: false, id: result.lastID };
    }
}

// ----- Generate receipt text -----
function generateReceiptText(data) {
    const { paymentId, amount, currency, reference, customerName, customerEmail } = data;
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-AU');
    const timeStr = now.toLocaleTimeString('en-AU');

    return `
╔═══════════════════════════════════════════════╗
║                 RECEIPT                       ║
╠═══════════════════════════════════════════════╣
║ Date: ${dateStr} ${timeStr}
║ Reference: ${reference || 'N/A'}
║ Payment ID: ${paymentId}
╠═══════════════════════════════════════════════╣
║ Customer: ${customerName || 'N/A'}
║ Email: ${customerEmail || 'N/A'}
╠═══════════════════════════════════════════════╣
║ Amount: ${currency} ${(amount / 100).toFixed(2)}
╠═══════════════════════════════════════════════╣
║ Transaction Status: ✅ SUCCESS
║ Thank you for your payment!
╚═══════════════════════════════════════════════╝
    `.trim();
}

// ----- Get a receipt by payment ID -----
async function getReceiptByPaymentId(paymentId) {
    return get('SELECT * FROM receipts WHERE pinch_payment_id = ?', [paymentId]);
}

// ----- Get a receipt by ID -----
async function getReceiptById(id) {
    return get('SELECT * FROM receipts WHERE id = ?', [id]);
}

// ----- Update receipt status -----
async function updateReceiptStatus(paymentId, status, pdfPath = null, pdfUrl = null) {
    await run(`
        UPDATE receipts 
        SET status = ?, 
            pdf_path = COALESCE(?, pdf_path),
            pdf_url = COALESCE(?, pdf_url),
            updated_at = datetime('now')
        WHERE pinch_payment_id = ?
    `, [status, pdfPath, pdfUrl, paymentId]);
}

// ----- Update receipt with PDF -----
async function updateReceiptWithPdf(paymentId, pdfPath, pdfUrl = null) {
    await run(`
        UPDATE receipts 
        SET pdf_path = ?, 
            pdf_url = COALESCE(?, pdf_url),
            status = 'generated',
            updated_at = datetime('now')
        WHERE pinch_payment_id = ?
    `, [pdfPath, pdfUrl, paymentId]);
}

// ----- Mark receipt as sent -----
async function markReceiptAsSent(paymentId) {
    await run(`
        UPDATE receipts 
        SET status = 'sent',
            updated_at = datetime('now')
        WHERE pinch_payment_id = ?
    `, [paymentId]);
}

// ----- Get all receipts (for dashboard) -----
async function getAllReceipts(limit = 50, offset = 0) {
    return all(
        `SELECT * FROM receipts ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
    );
}

// ----- Get receipts by customer email -----
async function getReceiptsByEmail(email) {
    return all(
        `SELECT * FROM receipts WHERE customer_email = ? ORDER BY created_at DESC`,
        [email]
    );
}

// ----- Get pending receipts (not processed) -----
async function getPendingReceipts() {
    return all(
        `SELECT * FROM receipts WHERE status = 'pending' ORDER BY created_at ASC`
    );
}

// ----- Delete a receipt -----
async function deleteReceipt(paymentId) {
    return run('DELETE FROM receipts WHERE pinch_payment_id = ?', [paymentId]);
}

// ============================================
// ✅ FIXED: getStats function
// ============================================
async function getStats() {
    try {
        const total = await get('SELECT COUNT(*) as count FROM receipts');
        const pending = await get("SELECT COUNT(*) as count FROM receipts WHERE status = 'pending'");
        const generated = await get("SELECT COUNT(*) as count FROM receipts WHERE status = 'generated'");
        const sent = await get("SELECT COUNT(*) as count FROM receipts WHERE status = 'sent'");
        const totalAmount = await get('SELECT SUM(amount) as total FROM receipts');

        return {
            total: total?.count || 0,
            pending: pending?.count || 0,
            generated: generated?.count || 0,
            sent: sent?.count || 0,
            totalAmount: totalAmount?.total || 0
        };
    } catch (error) {
        console.error('❌ Error getting stats:', error);
        return {
            total: 0,
            pending: 0,
            generated: 0,
            sent: 0,
            totalAmount: 0
        };
    }
}

module.exports = {
    db,
    get,
    all,
    run,
    saveReceiptFromWebhook,
    savePayer,
    getReceiptByPaymentId,
    getReceiptById,
    updateReceiptStatus,
    updateReceiptWithPdf,
    markReceiptAsSent,
    getAllReceipts,
    getReceiptsByEmail,
    getPendingReceipts,
    deleteReceipt,
    getStats,
    generateReceiptText
};