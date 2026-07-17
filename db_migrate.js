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
        
        console.log('Checking if table franquias exists...');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS franquias (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(150) NOT NULL,
                dia_vencimento INT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        `);
        console.log('Table franquias checked/created successfully.');

        console.log('Checking columns of table franquias...');
        const [franquiaCols] = await connection.execute('SHOW COLUMNS FROM franquias');
        const franquiaColNames = franquiaCols.map(c => c.Field);
        if (!franquiaColNames.includes('dia_vencimento')) {
            console.log('Adding column dia_vencimento to franquias...');
            await connection.execute('ALTER TABLE franquias ADD COLUMN dia_vencimento INT DEFAULT NULL AFTER nome');
            console.log('Column dia_vencimento added to franquias successfully.');
        }

        console.log('Checking columns of escola_configs...');
        const [columns] = await connection.execute('SHOW COLUMNS FROM escola_configs');
        const columnNames = columns.map(c => c.Field);
        
        if (!columnNames.includes('franquia_id')) {
            console.log('Adding column franquia_id...');
            await connection.execute('ALTER TABLE escola_configs ADD COLUMN franquia_id INT DEFAULT NULL AFTER status');
            console.log('Column franquia_id added successfully.');
            
            console.log('Adding foreign key constraint fk_escola_configs_franquia...');
            try {
                await connection.execute('ALTER TABLE escola_configs ADD CONSTRAINT fk_escola_configs_franquia FOREIGN KEY (franquia_id) REFERENCES franquias (id) ON DELETE SET NULL');
                console.log('Foreign key constraint added successfully.');
            } catch (fkErr) {
                console.error('Error adding foreign key constraint:', fkErr.message);
            }
        } else {
            console.log('Column franquia_id already exists.');
        }
        
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
