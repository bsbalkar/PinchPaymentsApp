// ============================================
// services/pdfGenerator.js
// PURPOSE: Generate clean PDF receipts
// ============================================

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const RECEIPTS_DIR = path.join(__dirname, '..', 'receipts');
if (!fs.existsSync(RECEIPTS_DIR)) {
    fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

// ----- Generate a clean PDF receipt -----
async function generateReceipt(receiptData) {
    return new Promise((resolve, reject) => {
        try {
            const {
                id,
                pinch_payment_id,
                customer_name,
                customer_email,
                amount,
                currency = 'AUD',
                reference,
                receipt_text,
                created_at,
                store_name = 'Store',
                staff_name = 'Staff',
                invoice_number,
                line_items = []
            } = receiptData;

            const paymentId = pinch_payment_id || id || `pmt_${Date.now()}`;
            const filename = `receipt_${paymentId}_${Date.now()}.pdf`;
            const filePath = path.join(RECEIPTS_DIR, filename);

            // ✅ Create PDF with proper settings
            const doc = new PDFDocument({
                size: 'A4',
                margin: 50,
                info: {
                    Title: `Receipt ${reference || paymentId}`,
                    Author: 'Pinch Receipt App',
                    Subject: 'Payment Receipt',
                    Creator: 'Pinch Me Hackathon'
                },
                compress: true // ✅ Enable compression for cleaner output
            });

            const writeStream = fs.createWriteStream(filePath);
            doc.pipe(writeStream);

            // ----- Header -----
            doc.fontSize(20)
               .font('Helvetica-Bold')
               .fillColor('#1a237e')
               .text('PINCH RECEIPT', { align: 'center' });
            
            doc.fillColor('#000000');
            doc.moveDown(0.5);

            // ----- Store Name -----
            doc.fontSize(14)
               .font('Helvetica-Bold')
               .text(store_name || 'Store', { align: 'center' });
            doc.moveDown(0.3);

            // ----- Divider -----
            doc.strokeColor('#cccccc')
               .lineWidth(1)
               .moveTo(50, doc.y)
               .lineTo(545, doc.y)
               .stroke();
            doc.moveDown(0.5);

            // ----- Payment Details -----
            const details = [
                ['Invoice #:', invoice_number || reference || 'N/A'],
                ['Payment ID:', paymentId],
                ['Date:', new Date(created_at || Date.now()).toLocaleString('en-AU')],
                ['Status:', '✅ SUCCESS'],
                ['Customer:', customer_name || 'N/A'],
                ['Email:', customer_email || 'N/A'],
                ['Staff:', staff_name || 'N/A']
            ];

            let yPos = doc.y;
            details.forEach(([label, value]) => {
                doc.fontSize(11)
                   .font('Helvetica-Bold')
                   .text(label, 50, yPos, { width: 120, align: 'left' });
                
                doc.font('Helvetica')
                   .text(String(value), 170, yPos, { width: 330, align: 'left' });
                
                yPos += 22;
            });

            doc.y = yPos + 10;

            // ----- Divider -----
            doc.strokeColor('#cccccc')
               .lineWidth(1)
               .moveTo(50, doc.y)
               .lineTo(545, doc.y)
               .stroke();
            doc.moveDown(0.5);

            // ----- Amount -----
            doc.fontSize(14)
               .font('Helvetica-Bold')
               .text('AMOUNT PAID', { align: 'center' });
            
            doc.moveDown(0.3);
            
            const displayAmount = amount || 0;
            doc.fontSize(28)
               .font('Helvetica-Bold')
               .fillColor('#2e7d32')
               .text(`${currency || 'AUD'} ${(displayAmount / 100).toFixed(2)}`, { align: 'center' });
            
            doc.fillColor('#000000');
            doc.moveDown(0.5);

            // ----- Divider -----
            doc.strokeColor('#cccccc')
               .lineWidth(1)
               .moveTo(50, doc.y)
               .lineTo(545, doc.y)
               .stroke();
            doc.moveDown(0.5);

            // ----- Line Items (if any) -----
            if (line_items && line_items.length > 0) {
                doc.fontSize(12)
                   .font('Helvetica-Bold')
                   .text('Items', { align: 'center' });
                doc.moveDown(0.3);

                line_items.forEach(item => {
                    const desc = item.description || 'Item';
                    const qty = item.quantity || 1;
                    const price = item.amount || 0;
                    const total = price * qty;
                    doc.fontSize(10)
                       .font('Helvetica')
                       .text(`${desc} × ${qty}`, 50, doc.y, { width: 300 })
                       .text(`$${(total / 100).toFixed(2)}`, 450, doc.y, { width: 100, align: 'right' });
                    doc.y += 18;
                });
                doc.moveDown(0.5);
            }

            // ----- Receipt Text (if any) -----
            if (receipt_text && typeof receipt_text === 'string') {
                // ✅ Clean the receipt text - remove any PostScript artifacts
                const cleanText = receipt_text
                    .replace(/%P/g, '')  // Remove %P artifacts
                    .replace(/%/g, '')    // Remove any stray %
                    .trim();

                if (cleanText && cleanText.length > 5) {
                    doc.fontSize(9)
                       .font('Courier')
                       .text(cleanText, {
                           align: 'left',
                           width: 495,
                           lineGap: 2
                       });
                    doc.moveDown(0.5);
                }
            }

            // ----- Footer -----
            doc.moveDown(0.5);
            doc.fontSize(10)
               .font('Helvetica')
               .fillColor('#666666')
               .text('Thank you for your payment!', { align: 'center' })
               .text(`Generated: ${new Date().toLocaleString('en-AU')}`, { align: 'center', fontSize: 8 })
               .text('This is a system-generated receipt.', { align: 'center', fontSize: 8 });

            // ✅ Finalize PDF
            doc.end();

            writeStream.on('finish', () => {
                console.log(`✅ PDF generated: ${filename}`);
                resolve({
                    filename,
                    filePath,
                    pdfUrl: `/receipts/${filename}`
                });
            });

            writeStream.on('error', (err) => {
                console.error('❌ Write stream error:', err);
                reject(err);
            });

        } catch (error) {
            console.error('❌ PDF generation failed:', error);
            reject(error);
        }
    });
}

module.exports = {
    generateReceipt,
    RECEIPTS_DIR
};