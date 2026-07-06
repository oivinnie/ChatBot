/**
 * DKSOFT Chatbot
 * Autor: Vinicius P Barbosa
 * Copyright © 2026. Todos os direitos reservados.
 * É proibida a reprodução ou distribuição sem autorização.
 */

const Firebird = require('node-firebird');

const options = {
    host: '127.0.0.1',
    port: 3050,
    database: 'C:\\DKSOFT_sistema\\DKSOFT.FDB',
    user: 'sysdba',
    password: 'masterkey',
    lowercase_keys: false,
    role: null,
    pageSize: 4096
};

Firebird.attach(options, function(err, db) {
    if (err) {
        console.error('Error connecting to DB:', err);
        process.exit(1);
    }
    
    const query = `
        SELECT 
            AC.ID_ALUNO_CURSO,
			AC.CONTRATO,
            AC.AULA_TIPO, 
            AC.ID_TURMA,
            AC.SITUACAO,
            P.NOME AS PACOTE_NOME,
            T.NOME AS TURMA_NOME
        FROM ALUNOS_CURSOS AC
        LEFT JOIN PACOTES P ON AC.ID_PACOTE = P.ID_PACOTE
        LEFT JOIN TURMAS T ON AC.ID_TURMA = T.ID_TURMA
        WHERE AC.ID_ALUNO = ?
    `;
    
    // Student 260
    db.query(query, [260], function(err, result) {
        if (err) console.error(err);
        else console.log('Courses for student 260:', result);
        
        // Student 272
        db.query(query, [272], function(err, result2) {
            if (err) console.error(err);
            else console.log('Courses for student 272:', result2);
            
            db.detach();
        });
    });
});
