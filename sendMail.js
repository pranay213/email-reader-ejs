const nodemailer = require('nodemailer');
require('dotenv').config();

const { EMAIL, PASSWORD } = process.env

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', // e.g., smtp.gmail.com
    port: 587,
    secure: false, // true for port 465, false for 587
    auth: {
        user: EMAIL,
        pass: PASSWORD
    }
});

const mailOptions = {
    from: 'your_email@example.com',
    to: 'pranaykodam.213@gmail.com',
    subject: 'Test Email',
    text: 'This is a test email sent via Node.js and SMTP'
};

transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
        return console.error('Error:', error);
    }
    console.log('Email sent:', info.response);
});
