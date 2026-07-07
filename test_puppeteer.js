require('dotenv').config();
const puppeteer = require('puppeteer');

async function test() {
    console.log('Iniciando teste do Puppeteer...');
    try {
        console.log('Tentando lançar o navegador...');
        const browser = await puppeteer.launch({
            headless: 'new', // ou true
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
        console.log('Navegador lançado com sucesso!');
        console.log('Abrindo nova página...');
        const page = await browser.newPage();
        console.log('Acessando https://www.google.com...');
        await page.goto('https://www.google.com', { timeout: 10000 });
        console.log('Acesso realizado com sucesso! Título:', await page.title());
        await browser.close();
        console.log('Teste concluído com SUCESSO!');
        process.exit(0);
    } catch (err) {
        console.error('Erro durante o teste do Puppeteer:', err);
        process.exit(1);
    }
}

test();
