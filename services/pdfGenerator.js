// ============================================
// services/pdfGenerator.js
// PURPOSE: Generate PDF receipts from payment data
// ============================================

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Ensure receipts directory exists
const RECEIPTS_DIR = path.join(__dirname, '..', 'receipts');
if (!fs.existsSync(RECEIPTS_DIR)) {
    fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

// ----- Generate a PDF receipt -----
async function generateReceiptPdf(receiptData) {
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
                created_at
            } = receiptData;

            // Create filename: receipt_{paymentId}.pdf
            const filename = `receipt_${pinch_payment_id || id}_${Date.now()}.pdf`;
            const filePath = path.join(RECEIPTS_DIR, filename);

            // Create PDF document
            const doc = new PDFDocument({
                size: 'A4',
                margin: 50,
                info: {
                    Title: `Receipt ${reference || pinch_payment_id}`,
                    Author: 'Pinch Receipt App',
                    Subject: 'Payment Receipt',
                    Creator: 'Pinch Me Hackathon'
                }
            });

            // Pipe to file
            const writeStream = fs.createWriteStream(filePath);
            doc.pipe(writeStream);

            // ----- Add content to PDF -----

            // Header: Logo / Title
            doc.fontSize(20)
               .font('Helvetica-Bold')
               .text('PINCH RECEIPT', { align: 'center' });
            
            doc.moveDown(0.5);
            
            // Divider line
            doc.strokeColor('#cccccc')
               .lineWidth(1)
               .moveTo(50, doc.y)
               .lineTo(545, doc.y)
               .stroke();
            
            doc.moveDown(1);

            // Receipt Title
            doc.fontSize(16)
               .font('Helvetica-Bold')
               .text('PAYMENT RECEIPT', { align: 'center' });
            
            doc.moveDown(1);

            // Transaction Details (Left aligned)
            const details = [
                ['Receipt Number:', reference || 'N/A'],
                ['Transaction ID:', pinch_payment_id || 'N/A'],
                ['Date:', new Date(created_at).toLocaleString('en-AU')],
                ['Status:', '✅ SUCCESS'],
                ['Customer:', customer_name || 'N/A'],
                ['Email:', customer_email || 'N/A']
            ];

            // Display in two columns
            let yPos = doc.y;
            details.forEach(([label, value]) => {
                doc.fontSize(11)
                   .font('Helvetica-Bold')
                   .text(label, 50, yPos, { width: 150, align: 'left' });
                
                doc.font('Helvetica')
                   .text(value, 170, yPos, { width: 300, align: 'left' });
                
                yPos += 25;
            });

            doc.y = yPos + 20;

            // Divider
            doc.strokeColor('#cccccc')
               .lineWidth(1)
               .moveTo(50, doc.y)
               .lineTo(545, doc.y)
               .stroke();
            
            doc.moveDown(1);

            // Amount Section
            doc.fontSize(14)
               .font('Helvetica-Bold')
               .text('AMOUNT PAID', { align: 'center' });
            
            doc.moveDown(0.5);
            
            doc.fontSize(28)
               .font('Helvetica-Bold')
               .fillColor('#2e7d32')
               .text(`${currency} ${(amount / 100).toFixed(2)}`, { align: 'center' });
            
            doc.fillColor('#000000');
            doc.moveDown(1);

            // Divider
            doc.strokeColor('#cccccc')
               .lineWidth(1)
               .moveTo(50, doc.y)
               .lineTo(545, doc.y)
               .stroke();
            
            doc.moveDown(1);

            // Receipt text (if available)
            if (receipt_text) {
                doc.fontSize(10)
                   .font('Helvetica')
                   .text(receipt_text, {
                       align: 'left',
                       width: 495,
                       lineGap: 2
                   });
                doc.moveDown(1);
            }

            // Footer
            doc.fontSize(10)
               .font('Helvetica')
               .fillColor('#666666')
               .text('Thank you for your payment!', { align: 'center' })
               .text(`Generated on ${new Date().toLocaleString('en-AU')}`, { align: 'center', fontSize: 8 })
               .text('This is a system-generated receipt. Please retain for your records.', { align: 'center', fontSize: 8 });

            // Finalize PDF
            doc.end();

            // Wait for file to be written
            writeStream.on('finish', () => {
                console.log(`✅ PDF generated: ${filename}`);
                resolve({
                    filename,
                    filePath,
                    pdfUrl: `/receipts/${filename}` // For local access
                });
            });

            writeStream.on('error', (err) => {
                reject(err);
            });

        } catch (error) {
            console.error('❌ PDF generation failed:', error);
            reject(error);
        }
    });
}

// ----- Generate PDF from receipt data (wrapper) -----
async function generateReceipt(receiptData) {
    try {
        // If receiptData is an object from the database, use it
        // If it's a payment ID, fetch from database first
        const result = await generateReceiptPdf(receiptData);
        return result;
    } catch (error) {
        console.error('❌ Failed to generate receipt:', error);
        throw error;
    }
}

// ----- List all generated receipts -----
function listReceipts() {
    return new Promise((resolve, reject) => {
        fs.readdir(RECEIPTS_DIR, (err, files) => {
            if (err) {
                reject(err);
                return;
            }
            const pdfFiles = files.filter(file => file.endsWith('.pdf'));
            resolve(pdfFiles.map(file => ({
                filename: file,
                path: path.join(RECEIPTS_DIR, file),
                url: `/receipts/${file}`
            })));
        });
    });
}

// ----- Delete a receipt PDF -----
function deleteReceiptPdf(filename) {
    return new Promise((resolve, reject) => {
        const filePath = path.join(RECEIPTS_DIR, filename);
        fs.unlink(filePath, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve({ deleted: true, filename });
        });
    });
}

module.exports = {
    generateReceipt,
    generateReceiptPdf,
    listReceipts,
    deleteReceiptPdf,
    RECEIPTS_DIR
};