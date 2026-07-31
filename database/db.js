// ============================================
// database/db.js
// PURPOSE: Database helper functions
// ============================================

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'receipts.db');
const db = new sqlite3.Database(dbPath);
db.run('PRAGMA foreign_keys = ON');

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

// ============================================================
// PAYER FUNCTIONS — FIXED
// ============================================================

async function savePayer(pinch_payer_id, email, firstName, lastName, phone = null) {
    try {
        // ✅ FIX: If payer ID is missing, generate a temporary one
        if (!pinch_payer_id || pinch_payer_id === 'null' || pinch_payer_id === 'undefined') {
            pinch_payer_id = `pyr_temp_${Date.now()}`;
            console.log('⚠️ Missing payer ID, using temporary:', pinch_payer_id);
        }

        // ✅ Ensure email is not null
        if (!email) {
            email = 'customer@example.com';
        }

        const existing = await get(
            'SELECT id FROM payers WHERE pinch_payer_id = ?',
            [pinch_payer_id]
        );

        if (existing) {
            await run(`
                UPDATE payers 
                SET email = ?, first_name = ?, last_name = ?, phone = ?, updated_at = datetime('now')
                WHERE pinch_payer_id = ?
            `, [email, firstName || 'Customer', lastName || 'User', phone, pinch_payer_id]);
            return { updated: true, id: existing.id };
        } else {
            const result = await run(`
                INSERT INTO payers (pinch_payer_id, email, first_name, last_name, phone)
                VALUES (?, ?, ?, ?, ?)
            `, [pinch_payer_id, email, firstName || 'Customer', lastName || 'User', phone]);
            return { updated: false, id: result.lastID };
        }
    } catch (error) {
        console.error('❌ Error saving payer:', error);
        // ✅ Try with a generated ID if the original fails
        if (error.code === 'SQLITE_CONSTRAINT') {
            const fallbackId = `pyr_fallback_${Date.now()}`;
            console.log('🔄 Retrying with fallback ID:', fallbackId);
            try {
                const result = await run(`
                    INSERT INTO payers (pinch_payer_id, email, first_name, last_name, phone)
                    VALUES (?, ?, ?, ?, ?)
                `, [fallbackId, email || 'customer@example.com', firstName || 'Customer', lastName || 'User', phone]);
                return { updated: false, id: result.lastID };
            } catch (fallbackError) {
                console.error('❌ Fallback also failed:', fallbackError);
                throw fallbackError;
            }
        }
        throw error;
    }
}

async function getPayer(pinch_payer_id) {
    return get('SELECT * FROM payers WHERE pinch_payer_id = ?', [pinch_payer_id]);
}

async function getPayerByEmail(email) {
    return get('SELECT * FROM payers WHERE email = ?', [email]);
}

// ============================================================
// RECEIPT FUNCTIONS — FIXED
// ============================================================

function generateReceiptText(data) {
    const { paymentId, amount, currency, reference, customerName, customerEmail } = data;
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-AU');
    const timeStr = now.toLocaleTimeString('en-AU');

    return `
PINCH PAYMENT RECEIPT
═══════════════════════════════════════
Payment ID: ${paymentId || 'N/A'}
Reference: ${reference || 'N/A'}
Date: ${dateStr} ${timeStr}
───────────────────────────────────────
Customer: ${customerName || 'N/A'}
Email: ${customerEmail || 'N/A'}
───────────────────────────────────────
Amount: ${currency || 'AUD'} ${(amount || 0 / 100).toFixed(2)}
Status: ✅ APPROVED
═══════════════════════════════════════
Thank you for your payment!
    `.trim();
}

async function saveReceiptFromWebhook(paymentData) {
    try {
        const {
            id: pinch_payment_id,
            payerId,
            amount,
            currency = 'AUD',
            reference,
            payer
        } = paymentData;

        // ✅ FIX: Ensure we have a valid payerId
        let payerIdToUse = payerId || paymentData.payer_id || `pyr_${Date.now()}`;
        
        // ✅ FIX: Get payer details with fallbacks
        const emailAddress = payer?.emailAddress || paymentData.email || 'customer@example.com';
        const firstName = payer?.firstName || paymentData.firstName || 'Customer';
        const lastName = payer?.lastName || paymentData.lastName || 'User';
        const customerName = `${firstName} ${lastName}`.trim();

        console.log('💾 Saving payer:', { payerIdToUse, emailAddress, firstName, lastName });

        // Save payer with fallback handling
        await savePayer(payerIdToUse, emailAddress, firstName, lastName);

        // Generate receipt text
        const receiptText = generateReceiptText({
            paymentId: pinch_payment_id || `pmt_${Date.now()}`,
            amount: amount || 0,
            currency: currency || 'AUD',
            reference: reference || 'N/A',
            customerName: customerName,
            customerEmail: emailAddress
        });

        // ✅ Check if receipt already exists
        const existing = await get(
            'SELECT id FROM receipts WHERE pinch_payment_id = ?',
            [pinch_payment_id]
        );

        let result;
        if (existing) {
            result = await run(`
                UPDATE receipts 
                SET payer_id = ?, customer_email = ?, customer_name = ?, 
                    amount = ?, currency = ?, reference = ?, receipt_text = ?,
                    updated_at = datetime('now')
                WHERE pinch_payment_id = ?
            `, [
                payerIdToUse, emailAddress, customerName,
                amount || 0, currency || 'AUD', reference || 'N/A', receiptText,
                pinch_payment_id
            ]);
            console.log('✅ Receipt updated:', pinch_payment_id);
        } else {
            result = await run(`
                INSERT INTO receipts (
                    pinch_payment_id, payer_id, customer_email, customer_name,
                    amount, currency, reference, receipt_text, status, webhook_received_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `, [
                pinch_payment_id || `pmt_${Date.now()}`, 
                payerIdToUse, 
                emailAddress, 
                customerName,
                amount || 0, 
                currency || 'AUD', 
                reference || 'N/A', 
                receiptText, 
                'generated'
            ]);
            console.log('✅ Receipt inserted:', pinch_payment_id || `pmt_${Date.now()}`);
        }

        return { ...result, receiptText };

    } catch (error) {
        console.error('❌ Error saving receipt:', error);
        throw error;
    }
}

async function getAllReceipts(limit = 50, offset = 0) {
    try {
        return await all(
            `SELECT * FROM receipts ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [limit, offset]
        );
    } catch (error) {
        console.error('❌ Error fetching receipts:', error);
        return [];
    }
}

async function getReceiptByPaymentId(paymentId) {
    return get('SELECT * FROM receipts WHERE pinch_payment_id = ?', [paymentId]);
}

async function getReceiptById(id) {
    return get('SELECT * FROM receipts WHERE id = ?', [id]);
}

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

async function markReceiptAsSent(paymentId) {
    await run(`
        UPDATE receipts 
        SET status = 'sent',
            updated_at = datetime('now')
        WHERE pinch_payment_id = ?
    `, [paymentId]);
}

async function getReceiptsByEmail(email) {
    return all(
        `SELECT * FROM receipts WHERE customer_email = ? ORDER BY created_at DESC`,
        [email]
    );
}

async function getPendingReceipts() {
    return all(
        `SELECT * FROM receipts WHERE status = 'pending' ORDER BY created_at ASC`
    );
}

async function deleteReceipt(paymentId) {
    return run('DELETE FROM receipts WHERE pinch_payment_id = ?', [paymentId]);
}

async function getStats() {
    try {
        const total = await get('SELECT COUNT(*) as count FROM receipts');
        const generated = await get("SELECT COUNT(*) as count FROM receipts WHERE status = 'generated'");
        const totalAmount = await get('SELECT SUM(amount) as total FROM receipts');

        return {
            total: total?.count || 0,
            pending: 0,
            generated: generated?.count || 0,
            sent: 0,
            totalAmount: totalAmount?.total || 0
        };
    } catch (error) {
        console.error('❌ Error getting stats:', error);
        return { total: 0, pending: 0, generated: 0, sent: 0, totalAmount: 0 };
    }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    db,
    get,
    all,
    run,
    savePayer,
    getPayer,
    getPayerByEmail,
    saveReceiptFromWebhook,
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