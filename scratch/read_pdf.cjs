const pdfParse = require('pdf-parse');
const fs = require('fs');
const data = fs.readFileSync('C:/Users/Manikanta Sridhar M/Downloads/0873-Le-Hart-Ltd.pdf');
pdfParse(data).then(result => { console.log(result.text); });
