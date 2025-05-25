const express = require('express');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

app.post('/login', async (req, res) => {
    const { email, appPassword } = req.body;

    if (!email || !appPassword) {
        return res.status(400).json({ error: 'Email and appPassword are required' });
    }

    const config = {
        imap: {
            user: email,
            password: appPassword,
            host: 'imap.gmail.com',
            port: 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 3000
        }
    };

    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const searchCriteria = ['ALL'];
        const fetchOptions = {
            bodies: ['HEADER', 'TEXT'],
            markSeen: false
        };

        const messages = await connection.search(searchCriteria, fetchOptions);

        // Create output directory for this user (to avoid conflicts)
        const safeEmail = email.replace(/[@.]/g, '_');
        const outputDir = path.join(__dirname, 'emails_html', safeEmail);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        let emailCount = 1;
        const savedFiles = [];

        for (const message of messages) {
            const textPart = message.parts.find(part => part.which === 'TEXT');

            if (!textPart) {
                console.warn('⚠️ Skipping message with no TEXT part');
                continue;
            }

            try {
                const parsed = await simpleParser(textPart.body);

                const subject = parsed.subject?.replace(/[<>:"/\\|?*]/g, '') || `Email_${emailCount}`;
                const filename = `${subject}_${emailCount}.html`;
                const filepath = path.join(outputDir, filename);

                const htmlContent = parsed.html || `<pre>${parsed.text || '(No content)'}</pre>`;

                fs.writeFileSync(filepath, htmlContent);
                console.log(`✅ Saved: ${filepath}`);

                savedFiles.push(filename);
                emailCount++;
            } catch (err) {
                console.error('❌ Failed to parse message:', err.message);
            }
        }

        await connection.end();

        res.json({ message: 'Emails fetched successfully', files: savedFiles });

    } catch (err) {
        console.error('❌ IMAP error:', err);
        res.status(400).json({ error: 'Failed to login or fetch emails', details: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
