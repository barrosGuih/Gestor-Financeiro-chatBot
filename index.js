const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const nameOfTheMechanic = "AUTOMECÂNICA LEÔNCIO";
const mainColor = '#E67E22'; 
const dataFile = './gestao_dados.json';

let transactions = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile)) : [];

function saveForDatebase(dados) {
    fs.writeFileSync(dataFile, JSON.stringify(dados, null, 2));
}

async function initializeBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sessao_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        mobile: false,
        browser: ['Oficina Leoncio', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('--- ESCANEIE O QR CODE ---');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('🔄 Conexão instável, reconectando...');
                setTimeout(() => initializeBot(), 3000);
            }
        } else if (connection === 'open') {
            console.log(`🚀 ${nameOfTheMechanic} - SISTEMA ONLINE`);
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const de = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const textLow = text.toLowerCase();

        const CEO = [
            '558399221895@s.whatsapp.net', '55839221895@s.whatsapp.net', 
            '5583981604819@s.whatsapp.net', '558381604819@s.whatsapp.net',
            '5583996918047@s.whatsapp.net', '558396918047@s.whatsapp.net',
            '193527082418320@lid' 
        ];

        if (!CEO.includes(de)) return;

    
        if (textLow === 'menu' || textLow === 'ajuda' || textLow === 'leoncio') {
            const menu = `*🛠️ ${nameOfTheMechanic}*\n` +
                         `Olá, Patrão! O que deseja registrar?\n\n` +
                         `*LANÇAR:* \nUse [+] para entradas e [-] para saídas.\n` +
                         `_Ex: + 250 Suspensão Gol_\n` +
                         `_Ex: - 100 Compra de Peças_\n\n` +
                         `*RELATÓRIOS:*\n` +
                         `• *resumo* (Ver últimos lançamentos)\n` +
                         `• *pdf* (Gerar relatório Laranja)\n` +
                         `• *limpar tudo* (Zerar histórico)`;
            
            await sock.sendMessage(de, { text: menu });
            return;
        }

        if (text.startsWith('+') || text.startsWith('-')) {
            const type = text.startsWith('+') ? 'Entrada' : 'Saída';
            const parts = text.split(' ');
            const valueStr = parts[1]?.replace(',', '.');
            const value = parseFloat(valueStr);
            const desc = parts.slice(2).join(' ') || 'Sem descrição';

            if (!isNaN(value)) {
                transactions.push({
                    data: new Date().toLocaleString('pt-BR'),
                    type,
                    value,
                    desc,
                    usuario: de.split('@')[0] 
                });
                saveForDatebase(transactions);
                await sock.sendMessage(de, { text: `✅ *Lançado!*\n💰 ${type}: R$ ${value.toFixed(2)}\n📝 Item: ${desc}` });
            } else {
                await sock.sendMessage(de, { text: '❌ Formato inválido! Tente: + 50.00 Descrição' });
            }
            return;
        }

        if (textLow === 'resumo') {
            if (transactions.length === 0) return await sock.sendMessage(de, { text: 'Nenhum dado registrado.' });

            let report = "```\n--- ÚLTIMOS LANÇAMENTOS ---\n\n";
            let ballance = 0;
            transactions.slice(-10).forEach(t => {
                const attribution = t.type === 'Entrada' ? '[+]' : '[-]';
                report += `${attribution} R$ ${t.value.toFixed(2).padEnd(8)} | ${t.desc}\n`;
                ballance += (t.type === 'Entrada' ? t.value : -t.value);
            });
            report += `\n--------------------------\n`;
            report += `ballance ATUAL: R$ ${ballance.toFixed(2)}\n\`\`\``;

            await sock.sendMessage(de, { text: report });
            return;
        }

        if (textLow === 'pdf') {
            await sock.sendMessage(de, { text: '📄 Gerando relatório da Oficina...' });

            const pdfPath = `./report_leoncio.pdf`;
            const doc = new PDFDocument({ margin: 40, size: 'A4' });
            const stream = fs.createWriteStream(pdfPath);

            doc.pipe(stream);

            doc.rect(0, 0, 600, 80).fill(mainColor);
            doc.fillColor('#FFFFFF').fontSize(24).text(nameOfTheMechanic, 40, 30);
            doc.fontSize(10).text('EXCELÊNCIA EM MANUTENÇÃO AUTOMOTIVA', 41, 55);
            doc.fontSize(8).text(`DATA: ${new Date().toLocaleString('pt-BR')}`, 450, 45, { align: 'right' });

            doc.moveDown(5);

            let totalIn = 0, totalOut = 0;
            transactions.forEach(t => t.type === 'Entrada' ? totalIn += t.value : totalOut += t.value);
            const ballanceFinal = totalIn - totalOut;

            doc.fillColor('#2C3E50').fontSize(14).text('RESUMO FINANCEIRO', 40, 100);
            doc.rect(40, 120, 160, 50).lineWidth(1).stroke(mainColor);
            doc.rect(215, 120, 160, 50).lineWidth(1).stroke(mainColor);
            doc.rect(390, 120, 165, 50).lineWidth(1).fillAndStroke(mainColor, mainColor);

            doc.fillColor('#2C3E50').fontSize(9).text('TOTAL ENTRADAS', 50, 130);
            doc.fillColor('green').fontSize(12).text(`R$ ${totalIn.toFixed(2)}`, 50, 145);
            doc.fillColor('#2C3E50').fontSize(9).text('TOTAL SAÍDAS', 225, 130);
            doc.fillColor('red').fontSize(12).text(`R$ ${totalOut.toFixed(2)}`, 225, 145);
            doc.fillColor('#FFFFFF').fontSize(9).text('ballance EM CAIXA', 400, 130);
            doc.fontSize(13).text(`R$ ${ballanceFinal.toFixed(2)}`, 400, 145, { bold: true });

            let rowY = 220;
            doc.rect(40, 200, 515, 20).fill(mainColor);
            doc.fillColor('#FFFFFF').fontSize(10).text('DATA', 45, 206).text('type', 120, 206).text('value', 170, 206).text('DESCRIÇÃO', 250, 206).text('USUÁRIO', 480, 206);

            transactions.forEach((t, i) => {
                if (rowY > 750) { doc.addPage(); rowY = 50; }
                if (i % 2 === 0) doc.rect(40, rowY, 515, 20).fill('#FFF5EB');
                doc.fillColor('#2C3E50').fontSize(9);
                doc.text(t.data.split(' ')[0], 45, rowY + 6);
                doc.fillColor(t.type === 'Entrada' ? 'green' : 'red').text(t.type, 120, rowY + 6);
                doc.fillColor('#2C3E50').text(`R$ ${t.value.toFixed(2)}`, 170, rowY + 6);
                doc.text(t.desc.substring(0, 40), 250, rowY + 6);
                doc.fontSize(7).text(t.usuario, 480, rowY + 7);
                rowY += 20;
            });

            doc.end();

            stream.on('finish', async () => {
                await sock.sendMessage(de, { 
                    document: fs.readFileSync(pdfPath), 
                    mimetype: 'application/pdf', 
                    fileName: `Gestao_Leoncio.pdf`,
                    caption: `🚗 Relatório da Oficina pronto!`
                });
            });
            return;
        }

        if (textLow === 'limpar tudo') {
            transactions = [];
            saveForDatebase(transactions);
            await sock.sendMessage(de, { text: '🗑️ Histórico de transações zerado!' });
            return;
        }
    });
}

initializeBot().catch(err => console.log("Erro:", err));