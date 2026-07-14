const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
    const connection = await mysql.createConnection({
        host: process.env.CENTRAL_DB_HOST,
        port: parseInt(process.env.CENTRAL_DB_PORT) || 3306,
        user: process.env.CENTRAL_DB_USER,
        password: process.env.CENTRAL_DB_PASSWORD,
        database: process.env.CENTRAL_DB_NAME
    });

    try {
        console.log(`Connecting to database at ${process.env.CENTRAL_DB_HOST}...`);
        
        console.log('Checking columns of escola_configs...');
        const [columns] = await connection.execute('SHOW COLUMNS FROM escola_configs');
        const columnNames = columns.map(c => c.Field);
        
        if (!columnNames.includes('numero_lancamento')) {
            console.log('Adding column numero_lancamento...');
            await connection.execute('ALTER TABLE escola_configs ADD COLUMN numero_lancamento VARCHAR(8) DEFAULT NULL');
            console.log('Column numero_lancamento added successfully.');
        } else {
            console.log('Column numero_lancamento already exists.');
        }

        if (!columnNames.includes('vencimento')) {
            console.log('Adding column vencimento...');
            await connection.execute('ALTER TABLE escola_configs ADD COLUMN vencimento DATE DEFAULT NULL');
            console.log('Column vencimento added successfully.');
        } else {
            console.log('Column vencimento already exists.');
        }

        console.log('Database migration completed.');
    } catch (err) {
        console.error('Error migrating database:', err);
    } finally {
        await connection.end();
    }
}

main();
