// ============================================
// Add this to database/db.js - Pinch fields
// ============================================

// ----- Save receipt with Pinch payment -----
async function saveReceiptFromPinch(paymentData) {
    const { 
        id: pinch_payment_id,
        payerId,
        amount,
        currency = 'AUD',
        reference,
        status,
        payer
    } = paymentData;

    const emailAddress = payer?.emailAddress || 'customer@example.com';
    const firstName = payer?.firstName || 'Customer';
    const lastName = payer?.lastName || 'User';

    // Save or update payer first
    await savePayer(payerId, emailAddress, firstName, lastName);

    // Generate receipt text
    const receiptText = generateReceiptText({
        paymentId: pinch_payment_id,
        amount,
        currency,
        reference,
        customerName: `${firstName} ${lastName}`.trim(),
        customerEmail: emailAddress,
        status: status || 'approved'
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
        currency || 'AUD',
        reference || `PAY-${Date.now()}`,
        receiptText,
        status || 'approved'
    ]);

    return { ...result, receiptText };
}

// ----- Generate receipt text with Pinch data -----
function generateReceiptText(data) {
    const { paymentId, amount, currency, reference, customerName, customerEmail, status } = data;
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-AU');
    const timeStr = now.toLocaleTimeString('en-AU');

    return `
╔═══════════════════════════════════════════════╗
║              PINCH RECEIPT                   ║
╠═══════════════════════════════════════════════╣
║ Payment ID: ${paymentId}
║ Reference: ${reference || 'N/A'}
║ Date: ${dateStr} ${timeStr}
╠═══════════════════════════════════════════════╣
║ Customer: ${customerName || 'N/A'}
║ Email: ${customerEmail || 'N/A'}
╠═══════════════════════════════════════════════╣
║ Amount: ${currency || 'AUD'} ${(amount / 100).toFixed(2)}
║ Status: ${status || 'approved'}
╠═══════════════════════════════════════════════╣
║ Transaction Status: ✅ SUCCESS
║ Thank you for your payment!
╚═══════════════════════════════════════════════╝
    `.trim();
}

// ----- Export the new functions -----
module.exports = {
    // ... existing exports
    saveReceiptFromPinch,
    generateReceiptText
};