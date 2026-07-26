// ============================================
// routes/webhooks.js
// PURPOSE: Handle webhooks
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { generateReceipt } = require('../services/pdfGenerator');

// ----- Handle payment created -----
async function handlePaymentCreated(paymentData) {
    console.log('💳 Processing payment:', paymentData.id);

    try {
        // ✅ SAFELY extract data
        const paymentId = paymentData.id || paymentData.pinch_payment_id || `pmt_${Date.now()}`;
        const payerId = paymentData.payerId || paymentData.payer_id || `pyr_${Date.now()}`;
        const amount = paymentData.amount || 0;
        const currency = paymentData.currency || 'AUD';
        const reference = paymentData.reference || `REF-${Date.now()}`;

        // ✅ SAFELY extract payer
        let email = 'customer@example.com';
        let firstName = 'Customer';
        let lastName = 'User';

        if (paymentData.payer) {
            email = paymentData.payer.emailAddress || paymentData.payer.email || email;
            firstName = paymentData.payer.firstName || paymentData.payer.first_name || firstName;
            lastName = paymentData.payer.lastName || paymentData.payer.last_name || lastName;
        }

        // ✅ Store info
        const storeName = paymentData.store_name || paymentData.storeName || 'Store';
        const staffName = paymentData.staff_name || paymentData.staffName || 'Staff';
        const invoiceNumber = paymentData.invoice_number || paymentData.invoiceNumber || reference;

        console.log('📋 Data:', { paymentId, email, firstName, lastName, amount, storeName });

        // Save payer
        await db.savePayer(payerId, email, firstName, lastName);

        // Generate receipt text
        let receiptText = paymentData.receipt_text || `
╔═══════════════════════════════════════════════╗
║              RECEIPT                         ║
╠═══════════════════════════════════════════════╣
║ Payment: ${paymentId}
║ Reference: ${reference}
║ Amount: ${currency} ${(amount / 100).toFixed(2)}
║ Status: ✅ SUCCESS
╚═══════════════════════════════════════════════╝
        `.trim();

        if (receiptText) {
    receiptText = receiptText
        .replace(/%P/g, '')  // Remove %P artifacts
        .replace(/%/g, '')    // Remove any stray %
        .trim();
}

        // Save to database
        await db.run(`
            INSERT OR REPLACE INTO receipts (
                pinch_payment_id, payer_id, customer_email, customer_name,
                amount, currency, reference, receipt_text, status, webhook_received_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `, [
            paymentId, payerId, email,
            `${firstName} ${lastName}`.trim(),
            amount, currency, reference,
            receiptText, 'pending'
        ]);

        console.log('✅ Receipt saved');

        // Get receipt and generate PDF
        const receipt = await db.getReceiptByPaymentId(paymentId);
        if (!receipt) throw new Error('Receipt not found');

        // Add extra fields for PDF
        receipt.store_name = storeName;
        receipt.staff_name = staffName;
        receipt.invoice_number = invoiceNumber;
        receipt.line_items = paymentData.line_items || [];

        const pdfResult = await generateReceipt(receipt);
        await db.updateReceiptWithPdf(paymentId, pdfResult.filePath, pdfResult.pdfUrl);

        console.log(`✅ Complete: ${paymentId}`);
        return { success: true, paymentId, pdfUrl: pdfResult.pdfUrl };

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    }
}

// ----- Routes -----
router.post('/pinch', async (req, res) => {
    try {
        const event = req.body;
        if (event.type === 'payment-created' || event.type === 'payment.succeeded') {
            await handlePaymentCreated(event.data);
        }
        res.json({ received: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/test', async (req, res) => {
    try {
        const result = await handlePaymentCreated(req.body);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
module.exports.handlePaymentCreated = handlePaymentCreated;