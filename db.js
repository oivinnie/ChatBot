/**
 * DKSOFT Chatbot - Database connection
 * Autor: Vinicius P Barbosa
 * Copyright © 2026.
 */

const Firebird = require('node-firebird');
const { decrypt, encrypt, getSchoolConnectionConfig } = require('./ConfigService');

// Configuração padrão de fallback para conexões locais/desenvolvimento
const fallbackConfig = {
    host: process.env.FALLBACK_DB_HOST || '127.0.0.1',
    port: parseInt(process.env.FALLBACK_DB_PORT) || 3050,
    database: process.env.FALLBACK_DB_PATH || 'C:\\DKSOFT_sistema\\DKSOFT.FDB',
    user: process.env.FALLBACK_DB_USER || 'sysdba',
    password: process.env.FALLBACK_DB_PASSWORD || 'masterkey'
};

// Analisa a string de conexão do banco de dados (ex: host/port:caminho ou host:caminho)
function parseDatabasePath(dbPath, defaultHost = '127.0.0.1', defaultPort = 3050) {
    let host = defaultHost;
    let port = defaultPort;
    let database = dbPath;

    if (!dbPath) {
        return { host, port, database };
    }

    // Formato: host/port:caminho (ex: 200.150.196.107/3050:34380)
    const matchSlashPortColon = dbPath.match(/^([^/]+)\/(\d+):(.+)$/);
    if (matchSlashPortColon) {
        host = matchSlashPortColon[1];
        port = parseInt(matchSlashPortColon[2]);
        database = matchSlashPortColon[3];
    } else {
        // Formato: host:caminho (ex: 200.150.196.107:34380)
        // O host não pode ser uma única letra de unidade de disco do Windows (ex: C:\)
        const matchHostColon = dbPath.match(/^([^:]{2,}):(.+)$/);
        if (matchHostColon) {
            host = matchHostColon[1];
            database = matchHostColon[2];
        }
    }

    return { host, port, database };
}

// Executa uma consulta no Firebird com suporte a conexão dinâmica
function execute(hashOrQuery, queryOrParams, params = []) {
    return new Promise((resolve, reject) => {
        let hash = null;
        let query = '';
        let queryParams = [];

        // Checa se o primeiro parâmetro é a query (compatibilidade antiga)
        if (typeof hashOrQuery === 'string' && 
            (hashOrQuery.trim().toUpperCase().startsWith('SELECT') || 
             hashOrQuery.trim().toUpperCase().startsWith('UPDATE') || 
             hashOrQuery.trim().toUpperCase().startsWith('INSERT') || 
             hashOrQuery.trim().toUpperCase().startsWith('DELETE') || 
             hashOrQuery.trim().toUpperCase().startsWith('EXECUTE') || 
             hashOrQuery.trim().toUpperCase().startsWith('WITH'))) {
            query = hashOrQuery;
            queryParams = queryOrParams || [];
        } else {
            hash = hashOrQuery;
            query = queryOrParams;
            queryParams = params;
        }

        let configPromise;
        if (hash) {
            configPromise = getSchoolConnectionConfig(hash)
                .then(schoolConn => ({
                    host: schoolConn.host,
                    port: schoolConn.port,
                    database: decrypt(schoolConn.banco_dk_encrypted),
                    user: schoolConn.user,
                    password: decrypt(schoolConn.senha_dk_encrypted)
                }));
        } else {
            configPromise = Promise.resolve(fallbackConfig);
        }

        configPromise.then(config => {
            const parsedDb = parseDatabasePath(config.database, config.host, config.port);

            const options = {
                host: parsedDb.host,
                port: parsedDb.port,
                database: parsedDb.database,
                user: config.user || 'sysdba',
                password: config.password || 'masterkey',
                lowercase_keys: false,
                pageSize: 4096
            };

            Firebird.attach(options, function(err, db) {
                if (err) {
                    return reject(err);
                }

                db.query(query, queryParams, async function(err, result) {
                    if (err) {
                        db.detach();
                        return reject(err);
                    }

                    try {
                        // Resolve BLOBs to Buffers if present
                        if (Array.isArray(result)) {
                            for (const row of result) {
                                for (const key of Object.keys(row)) {
                                    if (typeof row[key] === 'function') {
                                        row[key] = await new Promise((resolveBlob) => {
                                            row[key]((errBlob, name, e) => {
                                                if (errBlob) return resolveBlob(null);
                                                const chunks = [];
                                                e.on('data', chunk => chunks.push(chunk));
                                                e.on('end', () => resolveBlob(Buffer.concat(chunks)));
                                                e.on('error', () => resolveBlob(null));
                                            });
                                        });
                                    }
                                }
                            }
                        }
                        db.detach();
                        resolve(result);
                    } catch (blobErr) {
                        db.detach();
                        reject(blobErr);
                    }
                });
            });
        }).catch(reject);
    });
}

// Testa uma configuração específica
function testConnection(config) {
    return new Promise((resolve, reject) => {
        const parsedDb = parseDatabasePath(config.database, config.host, config.port);
        const options = {
            host: parsedDb.host,
            port: parsedDb.port,
            database: parsedDb.database,
            user: config.user || 'sysdba',
            password: config.password || 'masterkey',
            lowercase_keys: false,
            pageSize: 4096
        };

        Firebird.attach(options, function(err, db) {
            if (err) {
                return reject(err);
            }
            db.detach();
            resolve(true);
        });
    });
}

module.exports = {
    execute,
    testConnection,
    encrypt,
    decrypt
};
