// ============================================
// services/emailService.js
// PURPOSE: Send receipt emails via Proton Mail SMTP
// ============================================

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// ----- Create Proton Mail transporter -----
function createTransporter() {
    // Check if we're using Proton Mail
    const host = process.env.EMAIL_HOST || 'smtp.protonmail.ch';
    const port = parseInt(process.env.EMAIL_PORT) || 587;
    const secure = process.env.EMAIL_SECURE === 'true' || port === 465;

    console.log(`📧 Creating Proton Mail transporter: ${host}:${port} (secure: ${secure})`);

    return nodemailer.createTransport({
        host: host,
        port: port,
        secure: secure, // true for 465, false for 587
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
        // Proton Mail specific settings
        tls: {
            // Do not fail on invalid certs (for testing)
            rejectUnauthorized: false
        },
        // Timeout settings
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
    });
}

// ----- Send receipt email -----
async function sendReceiptEmail(toEmail, receiptData, pdfPath) {
    try {
        const transporter = createTransporter();

        const {
            reference,
            amount,
            currency = 'AUD',
            customer_name,
            pinch_payment_id,
            receipt_text
        } = receiptData;

        // Read PDF file
        let pdfBuffer = null;
        let hasAttachment = false;

        if (pdfPath && fs.existsSync(pdfPath)) {
            pdfBuffer = fs.readFileSync(pdfPath);
            hasAttachment = true;
            console.log(`📎 PDF attachment ready: ${path.basename(pdfPath)}`);
        }

        const mailOptions = {
            from: process.env.SENDER_EMAIL || process.env.EMAIL_USER,
            to: toEmail,
            subject: `Your Receipt ${reference ? `#${reference}` : ''}`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: #1a237e; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
                        .amount { font-size: 28px; color: #2e7d32; font-weight: bold; }
                        .details { width: 100%; margin: 20px 0; }
                        .details td { padding: 8px 12px; border-bottom: 1px solid #eee; }
                        .details tr:last-child td { border-bottom: none; }
                        .label { font-weight: bold; color: #555; }
                        .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; font-size: 12px; color: #666; }
                        .receipt-box { background: #fff; border: 1px solid #ddd; padding: 15px; font-family: monospace; font-size: 12px; white-space: pre-wrap; border-radius: 4px; margin: 15px 0; max-height: 300px; overflow-y: auto; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>🧾 Payment Receipt</h1>
                    </div>
                    <div class="content">
                        <h2>Thank you for your payment!</h2>
                        <p>Hi ${customer_name || 'Customer'},</p>
                        <p>Your payment has been successfully processed. Please find the details below.</p>

                        <table class="details">
                            <tr><td class="label">Reference:</td><td>${reference || 'N/A'}</td></tr>
                            <tr><td class="label">Amount:</td><td class="amount">${currency} ${(amount / 100).toFixed(2)}</td></tr>
                            <tr><td class="label">Transaction ID:</td><td>${pinch_payment_id || 'N/A'}</td></tr>
                            <tr><td class="label">Date:</td><td>${new Date().toLocaleString('en-AU')}</td></tr>
                        </table>

                        ${receipt_text ? `
                        <h3>📋 Receipt Details</h3>
                        <div class="receipt-box">${receipt_text}</div>
                        ` : ''}

                        ${hasAttachment ? `
                        <p style="margin-top: 20px;">
                            📎 <strong>PDF receipt attached</strong> — please keep this for your records.
                        </p>
                        ` : `
                        <p style="margin-top: 20px; color: #888;">
                            ℹ️ No PDF attachment was generated for this receipt.
                        </p>
                        `}

                        <p style="margin-top: 30px; font-size: 14px; color: #555;">
                            If you have any questions, please reply to this email.
                        </p>
                    </div>
                    <div class="footer">
                        <p>This is a system-generated receipt.</p>
                        <p>${new Date().toLocaleString('en-AU')}</p>
                    </div>
                </body>
                </html>
            `,
            attachments: hasAttachment ? [
                {
                    filename: `receipt_${reference || pinch_payment_id || 'payment'}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ] : []
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Receipt email sent to ${toEmail}`);
        console.log(`📨 Message ID: ${info.messageId}`);
        return info;

    } catch (error) {
        console.error('❌ Failed to send email:');
        console.error('Error:', error.message);
        
        // Provide helpful debugging info
        if (error.code === 'EAUTH') {
            console.error('💡 Authentication failed. Check your Proton Mail username and password.');
        } else if (error.code === 'ECONNECTION') {
            console.error('💡 Connection failed. Check your internet and SMTP settings.');
        }
        throw error;
    }
}

// ----- Send receipt with link (instead of attachment) -----
async function sendReceiptWithLink(toEmail, receiptData, pdfUrl) {
    try {
        const transporter = createTransporter();

        const {
            reference,
            amount,
            currency = 'AUD',
            customer_name,
            pinch_payment_id
        } = receiptData;

        const mailOptions = {
            from: process.env.SENDER_EMAIL || process.env.EMAIL_USER,
            to: toEmail,
            subject: `Your Receipt ${reference ? `#${reference}` : ''}`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: #1a237e; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
                        .amount { font-size: 28px; color: #2e7d32; font-weight: bold; }
                        .button { background: #1a237e; color: white; padding: 14px 35px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 20px 0; }
                        .details { width: 100%; margin: 20px 0; }
                        .details td { padding: 8px 12px; border-bottom: 1px solid #eee; }
                        .label { font-weight: bold; color: #555; }
                        .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; font-size: 12px; color: #666; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>🧾 Payment Receipt</h1>
                    </div>
                    <div class="content">
                        <h2>Thank you for your payment!</h2>
                        <p>Hi ${customer_name || 'Customer'},</p>
                        <p>Your payment has been successfully processed.</p>

                        <table class="details">
                            <tr><td class="label">Reference:</td><td>${reference || 'N/A'}</td></tr>
                            <tr><td class="label">Amount:</td><td class="amount">${currency} ${(amount / 100).toFixed(2)}</td></tr>
                            <tr><td class="label">Date:</td><td>${new Date().toLocaleString('en-AU')}</td></tr>
                        </table>

                        <p style="text-align: center; margin: 30px 0;">
                            <a href="${pdfUrl}" class="button" target="_blank">📄 View / Download Receipt</a>
                        </p>

                        <p>Please retain this for your records.</p>
                    </div>
                    <div class="footer">
                        <p>This is a system-generated receipt.</p>
                        <p>${new Date().toLocaleString('en-AU')}</p>
                    </div>
                </body>
                </html>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Receipt link sent to ${toEmail}`);
        return info;

    } catch (error) {
        console.error('❌ Failed to send email:', error.message);
        throw error;
    }
}

module.exports = {
    sendReceiptEmail,
    sendReceiptWithLink
};