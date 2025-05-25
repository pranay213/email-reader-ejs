const express = require('express');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Set view engine
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());

// IMAP configuration
const imapConfig = {
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.IMAP_PORT) || 993,
    tls: true,
    tlsOptions: {
        rejectUnauthorized: false
    }
};

// Helper function to connect to IMAP
function connectIMAP() {
    return new Promise((resolve, reject) => {
        const imap = new Imap(imapConfig);

        imap.once('ready', () => {
            resolve(imap);
        });

        imap.once('error', (err) => {
            reject(err);
        });

        imap.connect();
    });
}

// Helper function to fetch emails
function fetchEmails(imap, searchCriteria = ['ALL'], limit = 20) {
    return new Promise((resolve, reject) => {
        imap.openBox('INBOX', true, (err, box) => {
            if (err) {
                reject(err);
                return;
            }

            imap.search(searchCriteria, (err, results) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (!results || results.length === 0) {
                    resolve([]);
                    return;
                }

                // Get the most recent emails
                const recentResults = results.slice(-limit).reverse();

                const fetch = imap.fetch(recentResults, {
                    bodies: '',
                    struct: true
                });

                const emails = [];
                let processedCount = 0;

                fetch.on('message', (msg, seqno) => {
                    let emailData = {};
                    let uid = null;

                    msg.once('attributes', (attrs) => {
                        uid = attrs.uid;
                    });

                    msg.on('body', (stream, info) => {
                        let buffer = '';
                        stream.on('data', (chunk) => {
                            buffer += chunk.toString('utf8');
                        });

                        stream.once('end', () => {
                            simpleParser(buffer, (err, parsed) => {
                                if (!err) {
                                    emailData = {
                                        id: uid || seqno, // Use UID if available, fallback to seqno
                                        seqno: seqno,
                                        uid: uid,
                                        subject: parsed.subject || '(No Subject)',
                                        from: parsed.from?.text || 'Unknown Sender',
                                        date: parsed.date || new Date(),
                                        text: parsed.text || '',
                                        html: parsed.html || '',
                                        preview: (parsed.text || '').substring(0, 200) + '...'
                                    };
                                    emails.push(emailData);
                                }
                                processedCount++;

                                // Check if all messages are processed
                                if (processedCount === recentResults.length) {
                                    // Sort emails by date (newest first)
                                    emails.sort((a, b) => new Date(b.date) - new Date(a.date));
                                    resolve(emails);
                                }
                            });
                        });
                    });
                });

                fetch.once('error', (err) => {
                    reject(err);
                });

                fetch.once('end', () => {
                    // Fallback in case processedCount doesn't match
                    setTimeout(() => {
                        if (emails.length > 0) {
                            emails.sort((a, b) => new Date(b.date) - new Date(a.date));
                            resolve(emails);
                        }
                    }, 1000);
                });
            });
        });
    });
}

// Helper function to fetch single email
function fetchSingleEmail(imap, emailId) {
    return new Promise((resolve, reject) => {
        imap.openBox('INBOX', true, (err, box) => {
            if (err) {
                reject(err);
                return;
            }

            // First try to search for all messages to get the mapping
            imap.search(['ALL'], (err, results) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Try to find the email by UID first, then by sequence number
                let targetId = emailId;
                let useUid = false;

                // Check if emailId exists in results (as sequence number)
                if (!results.includes(parseInt(emailId))) {
                    // If not found as sequence number, search by UID
                    useUid = true;
                }

                const fetchOptions = {
                    bodies: '',
                    struct: true
                };

                let fetch;
                if (useUid) {
                    // Fetch by UID
                    fetch = imap.fetch([emailId], fetchOptions);
                } else {
                    // Fetch by sequence number
                    fetch = imap.fetch([emailId], fetchOptions);
                }

                let emailData = {};
                let found = false;

                fetch.on('message', (msg, seqno) => {
                    found = true;
                    let uid = null;

                    msg.once('attributes', (attrs) => {
                        uid = attrs.uid;
                    });

                    msg.on('body', (stream, info) => {
                        let buffer = '';
                        stream.on('data', (chunk) => {
                            buffer += chunk.toString('utf8');
                        });

                        stream.once('end', () => {
                            simpleParser(buffer, (err, parsed) => {
                                if (!err) {
                                    emailData = {
                                        id: uid || seqno,
                                        seqno: seqno,
                                        uid: uid,
                                        subject: parsed.subject || '(No Subject)',
                                        from: parsed.from?.text || 'Unknown Sender',
                                        to: parsed.to?.text || '',
                                        date: parsed.date || new Date(),
                                        text: parsed.text || '',
                                        html: parsed.html || ''
                                    };
                                }
                            });
                        });
                    });
                });

                fetch.once('error', (err) => {
                    console.error('Fetch error:', err);
                    reject(err);
                });

                fetch.once('end', () => {
                    if (found && emailData.subject) {
                        resolve(emailData);
                    } else {
                        // Try alternative approach - get recent emails and find the matching one
                        fetchEmailsSimple(imap, 50).then(emails => {
                            const foundEmail = emails.find(email =>
                                email.id == emailId || email.seqno == emailId || email.uid == emailId
                            );
                            if (foundEmail) {
                                resolve(foundEmail);
                            } else {
                                reject(new Error('Email not found in recent messages'));
                            }
                        }).catch(reject);
                    }
                });
            });
        });
    });
}

// Simplified email fetch for fallback
function fetchEmailsSimple(imap, limit = 50) {
    return new Promise((resolve, reject) => {
        imap.search(['ALL'], (err, results) => {
            if (err) {
                reject(err);
                return;
            }

            if (!results || results.length === 0) {
                resolve([]);
                return;
            }

            const recentResults = results.slice(-limit);
            const fetch = imap.fetch(recentResults, {
                bodies: '',
                struct: true
            });

            const emails = [];
            let processedCount = 0;

            fetch.on('message', (msg, seqno) => {
                let uid = null;

                msg.once('attributes', (attrs) => {
                    uid = attrs.uid;
                });

                msg.on('body', (stream, info) => {
                    let buffer = '';
                    stream.on('data', (chunk) => {
                        buffer += chunk.toString('utf8');
                    });

                    stream.once('end', () => {
                        simpleParser(buffer, (err, parsed) => {
                            if (!err) {
                                emails.push({
                                    id: uid || seqno,
                                    seqno: seqno,
                                    uid: uid,
                                    subject: parsed.subject || '(No Subject)',
                                    from: parsed.from?.text || 'Unknown Sender',
                                    to: parsed.to?.text || '',
                                    date: parsed.date || new Date(),
                                    text: parsed.text || '',
                                    html: parsed.html || ''
                                });
                            }
                            processedCount++;

                            if (processedCount === recentResults.length) {
                                resolve(emails);
                            }
                        });
                    });
                });
            });

            fetch.once('error', reject);
            fetch.once('end', () => {
                setTimeout(() => resolve(emails), 500);
            });
        });
    });
}

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/emails', async (req, res) => {
    try {
        const imap = await connectIMAP();

        let searchCriteria = ['ALL'];
        const query = req.query.q;

        if (query) {
            // Search in subject and body
            searchCriteria = ['OR', ['SUBJECT', query], ['BODY', query]];
        }

        const emails = await fetchEmails(imap, searchCriteria, 20);

        imap.end();

        res.render('emails', { emails, query });
    } catch (error) {
        console.error('Error fetching emails:', error);
        res.render('error', {
            error: 'Failed to connect to email server. Please check your credentials.',
            details: error.message
        });
    }
});

app.get('/email/:id', async (req, res) => {
    try {
        const emailId = req.params.id;
        console.log('Fetching email with ID:', emailId);

        const imap = await connectIMAP();

        const email = await fetchSingleEmail(imap, emailId);

        imap.end();

        if (!email || !email.subject) {
            console.log('Email not found or empty:', email);
            return res.status(404).render('error', {
                error: 'Email not found',
                details: `Could not retrieve email with ID: ${emailId}. The email may have been deleted or moved.`
            });
        }

        console.log('Email found:', email.subject);
        res.render('email-detail', { email });
    } catch (error) {
        console.error('Error fetching email:', error);
        res.render('error', {
            error: 'Failed to fetch email details',
            details: `Error: ${error.message}. Email ID: ${req.params.id}`
        });
    }
});

app.get('/test-connection', async (req, res) => {
    try {
        const imap = await connectIMAP();
        imap.end();
        res.json({ status: 'success', message: 'Successfully connected to email server' });
    } catch (error) {
        console.error('Connection test failed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to connect to email server',
            details: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Email configuration:');
    console.log(`- Host: ${imapConfig.host}:${imapConfig.port}`);
    console.log(`- User: ${imapConfig.user}`);
    console.log('- Password: [HIDDEN]');
});