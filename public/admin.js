/**
 * DKSOFT Chatbot - Admin Dashboard frontend logic
 * Autor: Vinicius P Barbosa
 * Copyright © 2026.
 */

const themes = {
    indigo: {
        bgColor: '#f3f4f6',
        primaryGradient: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
        bodyBg: 'radial-gradient(at 0% 0%, rgba(79, 70, 229, 0.08) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(6, 182, 212, 0.08) 0px, transparent 50%), radial-gradient(at 50% 100%, rgba(124, 58, 237, 0.05) 0px, transparent 50%)'
    },
    blue: {
        bgColor: '#e0f2fe',
        primaryGradient: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
        bodyBg: 'radial-gradient(at 0% 0%, rgba(2, 132, 199, 0.1) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(56, 189, 248, 0.1) 0px, transparent 50%)'
    },
    green: {
        bgColor: '#dcfce7',
        primaryGradient: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
        bodyBg: 'radial-gradient(at 0% 0%, rgba(5, 150, 105, 0.1) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(52, 211, 153, 0.1) 0px, transparent 50%)'
    },
    pink: {
        bgColor: '#fce7f3',
        primaryGradient: 'linear-gradient(135deg, #db2777 0%, #be185d 100%)',
        bodyBg: 'radial-gradient(at 0% 0%, rgba(219, 39, 119, 0.1) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(244, 114, 182, 0.1) 0px, transparent 50%)'
    },
    amber: {
        bgColor: '#fef3c7',
        primaryGradient: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
        bodyBg: 'radial-gradient(at 0% 0%, rgba(217, 119, 6, 0.1) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(251, 191, 36, 0.1) 0px, transparent 50%)'
    },
    gray: {
        bgColor: '#e5e7eb',
        primaryGradient: 'linear-gradient(135deg, #374151 0%, #1f2937 100%)',
        bodyBg: 'radial-gradient(at 0% 0%, rgba(55, 65, 81, 0.1) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(156, 163, 175, 0.1) 0px, transparent 50%)'
    }
};

function applyTheme(themeName) {
    const theme = themes[themeName] || themes.indigo;
    document.documentElement.style.setProperty('--bg-color', theme.bgColor);
    document.documentElement.style.setProperty('--primary-gradient', theme.primaryGradient);
    document.documentElement.style.setProperty('--user-bubble', theme.primaryGradient);
    document.body.style.backgroundImage = theme.bodyBg;
}

// Obtém o hash da URL query parameter
const urlParams = new URLSearchParams(window.location.search);
const hash = urlParams.get('hash') || '';

// DOM Elements - Login Section
const loginSection = document.getElementById('loginSection');
const loginSchoolId = document.getElementById('loginSchoolId');
const loginSchoolCnpj = document.getElementById('loginSchoolCnpj');
const loginValidateBtn = document.getElementById('loginValidateBtn');
const dkappInactiveWarning = document.getElementById('dkappInactiveWarning');

// DOM Elements - Config Section
const configSection = document.getElementById('configSection');
const botEmoji = document.getElementById('botEmoji');
const portalAlunoLink = document.getElementById('portalAlunoLink');
const atendimentoNumero = document.getElementById('atendimentoNumero');
const cadastroInteressadosLink = document.getElementById('cadastroInteressadosLink');
const validadorCertificadoLink = document.getElementById('validadorCertificadoLink');
const themeSelect = document.getElementById('themeSelect');

const showFinanceiro = document.getElementById('showFinanceiro');
const showHorarios = document.getElementById('showHorarios');
const showBoletim = document.getElementById('showBoletim');
const showPlataforma = document.getElementById('showPlataforma');
const showConteudo = document.getElementById('showConteudo');
const showValidador = document.getElementById('showValidador');
const showInteressados = document.getElementById('showInteressados');

const widgetPosition = document.getElementById('widgetPosition');
const widgetText = document.getElementById('widgetText');
const widgetTestLink = document.getElementById('widgetTestLink');

const testBtn = document.getElementById('testBtn');
const saveBtn = document.getElementById('saveBtn');

// Controla o fluxo de exibição das telas
function setupPageFlow() {
    if (hash) {
        localStorage.setItem('school_hash', hash);
        loginSection.style.display = 'none';
        configSection.style.display = 'flex';
        loadConfig();
        checkWhatsAppStatus();
        // Polling do WhatsApp a cada 3 segundos
        setInterval(checkWhatsAppStatus, 3000);
    } else {
        loginSection.style.display = 'flex';
        configSection.style.display = 'none';
        applyTheme('indigo'); // Tema padrão para login
    }
}

// Desloga/Troca de escola
function logoutSchool() {
    window.location.href = 'admin.html';
}

// Habilita ou desabilita campos de configuração
function disableConfigFields(disabled) {
    const fields = [
        portalAlunoLink, atendimentoNumero, cadastroInteressadosLink,
        validadorCertificadoLink, themeSelect, botEmoji, showFinanceiro,
        showHorarios, showBoletim, showPlataforma, showConteudo,
        showValidador, showInteressados, widgetPosition, widgetText, testBtn, saveBtn,
        document.getElementById('waRefreshBtn'), document.getElementById('waDisconnectBtn')
    ];
    fields.forEach(field => {
        if (field) field.disabled = disabled;
    });
}

// Função para formatar máscara de telefone
function formatPhone(value) {
    if (!value) return '';
    const clean = value.replace(/\D/g, '');
    
    if (clean.startsWith('55') && clean.length > 2) {
        const ddi = '55';
        const rest = clean.substring(2);
        if (rest.length <= 2) {
            return `+${ddi} (${rest}`;
        } else if (rest.length <= 6) {
            return `+${ddi} (${rest.substring(0, 2)}) ${rest.substring(2)}`;
        } else if (rest.length <= 10) {
            return `+${ddi} (${rest.substring(0, 2)}) ${rest.substring(2, 6)}-${rest.substring(6)}`;
        } else {
            return `+${ddi} (${rest.substring(0, 2)}) ${rest.substring(2, 7)}-${rest.substring(7, 11)}`;
        }
    } else {
        if (clean.length <= 2) {
            return clean;
        } else if (clean.length <= 6) {
            return `(${clean.substring(0, 2)}) ${clean.substring(2)}`;
        } else if (clean.length <= 10) {
            return `(${clean.substring(0, 2)}) ${clean.substring(2, 6)}-${clean.substring(6)}`;
        } else {
            return `(${clean.substring(0, 2)}) ${clean.substring(2, 7)}-${clean.substring(7, 11)}`;
        }
    }
}

// Carrega as configuracoes atuais do servidor
async function loadConfig() {
    if (!hash) return;
    disableConfigFields(false);

    try {
        const response = await fetch(`/api/config?hash=${hash}`);
        const config = await response.json();
        
        if (portalAlunoLink) portalAlunoLink.value = config.portal_aluno_link || 'https://portal.dksoft.com.br/';
        if (atendimentoNumero) atendimentoNumero.value = formatPhone(config.atendimento_numero || '');
        if (cadastroInteressadosLink) cadastroInteressadosLink.value = config.cadastro_interessados_link || '';
        if (validadorCertificadoLink) validadorCertificadoLink.value = config.validador_certificado_link || 'https://suportedksoft.com.br/certificado/';
        if (themeSelect) themeSelect.value = config.theme || 'indigo';
        if (botEmoji) botEmoji.value = config.emoji || '🤖';
        
        if (showFinanceiro) showFinanceiro.checked = config.show_financeiro !== false;
        if (showHorarios) showHorarios.checked = config.show_horarios !== false;
        if (showBoletim) showBoletim.checked = config.show_boletim !== false;
        if (showPlataforma) showPlataforma.checked = config.show_plataforma !== false;
        if (showConteudo) showConteudo.checked = config.show_conteudo !== false;
        if (showValidador) showValidador.checked = config.show_validador !== false;
        if (showInteressados) showInteressados.checked = config.show_interessados !== false;

        if (widgetPosition) widgetPosition.value = config.widget_position || 'right';
        if (widgetText) widgetText.value = config.widget_text || 'Posso ajudar?';

        if (themeSelect) applyTheme(themeSelect.value);

        // Atualiza a visualização do widget test
        if (widgetTestLink) {
            widgetTestLink.href = `/widget-test.html?hash=${hash}`;
        }

        // Atualizar instrução de incorporação com o hash da escola
        const embedBox = document.querySelector('.code-box-embed');
        if (embedBox) {
            const hostUrl = window.location.origin;
            embedBox.textContent = `<script src="${hostUrl}/widget.js?hash=${hash}"></script>`;
        }

        // Buscar informações adicionais da empresa para exibir no cabeçalho
        try {
            const infoResponse = await fetch(`/api/info?hash=${hash}`);
            const infoData = await infoResponse.json();
            const headerTitle = document.getElementById('adminTitleHeader');
            if (headerTitle && infoData.id_atendimento && infoData.nome_fantasia) {
                headerTitle.textContent = `Painel de Configuração do ChatBot - Escola ${infoData.id_atendimento} (${infoData.nome_fantasia})`;
            }
        } catch (infoErr) {
            console.error('Erro ao carregar detalhes da empresa no cabeçalho:', infoErr);
        }
    } catch (err) {
        console.error('Erro ao carregar configuracoes:', err);
        showAlert('error', 'Falha ao carregar as configurações do servidor.');
    }
}

// Exibe o modal customizado de alerta ou confirmação
function showCustomModal({ title, message, icon = '⚠️', isConfirm = false, onConfirm, onCancel }) {
    const modal = document.getElementById('customModal');
    const mTitle = document.getElementById('modalTitle');
    const mBody = document.getElementById('modalBody');
    const mIcon = document.getElementById('modalIcon');
    const btnCancel = document.getElementById('modalCancelBtn');
    const btnConfirm = document.getElementById('modalConfirmBtn');

    mTitle.textContent = title || 'Atenção';
    mBody.textContent = message || '';
    mIcon.textContent = icon;

    if (isConfirm) {
        btnCancel.style.display = 'inline-block';
        btnConfirm.textContent = 'Sim, Desconectar';
        btnConfirm.style.background = '#ef4444';
        btnConfirm.style.borderColor = '#ef4444';
        btnConfirm.style.color = '#ffffff';
    } else {
        btnCancel.style.display = 'none';
        btnConfirm.textContent = 'OK';
        btnConfirm.style.background = '#4f46e5';
        btnConfirm.style.borderColor = '#4f46e5';
        btnConfirm.style.color = '#ffffff';
    }

    modal.style.display = 'flex';
    modal.offsetHeight; // Força reflow
    modal.style.opacity = '1';
    modal.querySelector('.modal-content').style.transform = 'scale(1)';

    const newBtnConfirm = btnConfirm.cloneNode(true);
    const newBtnCancel = btnCancel.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

    const closeModal = () => {
        modal.style.opacity = '0';
        modal.querySelector('.modal-content').style.transform = 'scale(0.9)';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 200);
    };

    newBtnConfirm.addEventListener('click', () => {
        closeModal();
        if (onConfirm) onConfirm();
    });

    newBtnCancel.addEventListener('click', () => {
        closeModal();
        if (onCancel) onCancel();
    });
}

// Exibe alertas na tela redirecionando para o modal customizado
function showAlert(type, message) {
    if (type === 'success') {
        showCustomModal({ title: 'Sucesso', message, icon: '🎉' });
    } else {
        showCustomModal({ title: 'Erro', message, icon: '❌' });
    }
}

// Bloqueia ou desbloqueia botoes de acao
function setButtonsState(disabled, textTest = 'Testar Conexão', textSave = 'Salvar') {
    testBtn.disabled = disabled;
    saveBtn.disabled = disabled;
    
    testBtn.querySelector('span').textContent = textTest;
    saveBtn.querySelector('span').textContent = textSave;
}

// Valida a escola na base central MySQL (Login/Entrada)
async function validateSchool() {
    dkappInactiveWarning.style.display = 'none';
    const idVal = loginSchoolId.value.trim();
    const cnpjVal = loginSchoolCnpj.value.trim();
    
    if (!idVal || !cnpjVal) {
        showAlert('error', 'Preencha o ID da escola e o CNPJ para validar.');
        return;
    }
    
    loginValidateBtn.disabled = true;
    loginValidateBtn.querySelector('span').textContent = 'Validando...';
    
    try {
        const response = await fetch('/api/escola/validar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id_atendimento: idVal, cnpj: cnpjVal })
        });
        
        const status = response.status;
        const data = await response.json();
        
        loginValidateBtn.disabled = false;
        loginValidateBtn.querySelector('span').textContent = 'Validar & Entrar';
        
        if (data.success) {
            localStorage.setItem('school_hash', data.hash);
            showCustomModal({
                title: 'Sucesso',
                message: `Escola Validada com Sucesso!\n\nID: ${data.id_atendimento}\nNome Fantasia: ${data.nome_fantasia}`,
                icon: '🎉',
                onConfirm: () => {
                    window.location.search = '?hash=' + data.hash;
                }
            });
        } else if (status === 403 || data.error === 'DKAPP_INACTIVE') {
            // DKAPP Inativo - Exibir caixa vermelha com aviso e link do suporte
            dkappInactiveWarning.style.display = 'block';
        } else {
            showAlert('error', `Falha na validação: ${data.error}`);
        }
    } catch (err) {
        loginValidateBtn.disabled = false;
        loginValidateBtn.querySelector('span').textContent = 'Validar & Entrar';
        console.error('Erro ao validar escola:', err);
        showAlert('error', 'Erro de comunicação ao validar a escola no servidor.');
    }
}

// Testa a conexao com os parametros atuais do formulario
async function testConnection() {
    if (!hash) return;
    setButtonsState(true, 'Testando...', 'Salvar');
    
    try {
        const response = await fetch('/api/config/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ hash })
        });
        
        const data = await response.json();
        setButtonsState(false);
        
        if (data.success) {
            showAlert('success', 'Conexão com o banco de dados da escola realizada com sucesso! 🎉');
        } else {
            showAlert('error', `Falha na conexão: ${data.error}`);
        }
    } catch (err) {
        setButtonsState(false);
        console.error('Erro ao testar conexao:', err);
        showAlert('error', 'Ocorreu um erro ao tentar testar a conexão.');
    }
}

// Salva as configuracoes no banco central
async function saveConfig() {
    if (!hash) return;
    
    // Validar se ao menos 1 checkbox esta marcado
    if (!showFinanceiro.checked && !showHorarios.checked && !showBoletim.checked && !showPlataforma.checked && !showConteudo.checked && !showValidador.checked && !showInteressados.checked) {
        showAlert('error', 'Selecione pelo menos uma opção para ser exibida no chatbot.');
        return;
    }

    setButtonsState(true, 'Testar Conexão', 'Salvando...');
    
    const configData = {
        hash: hash,
        portal_aluno_link: portalAlunoLink ? portalAlunoLink.value : '',
        atendimento_numero: atendimentoNumero ? atendimentoNumero.value.replace(/\D/g, '') : '',
        cadastro_interessados_link: cadastroInteressadosLink ? cadastroInteressadosLink.value : '',
        validador_certificado_link: validadorCertificadoLink ? validadorCertificadoLink.value : '',
        theme: themeSelect ? themeSelect.value : 'indigo',
        emoji: botEmoji ? botEmoji.value : '🤖',
        show_financeiro: showFinanceiro ? showFinanceiro.checked : true,
        show_horarios: showHorarios ? showHorarios.checked : true,
        show_boletim: showBoletim ? showBoletim.checked : true,
        show_plataforma: showPlataforma ? showPlataforma.checked : true,
        show_conteudo: showConteudo ? showConteudo.checked : true,
        show_validador: showValidador ? showValidador.checked : true,
        show_interessados: showInteressados ? showInteressados.checked : true,
        widget_position: widgetPosition ? widgetPosition.value : 'right',
        widget_text: widgetText ? widgetText.value : 'Posso ajudar?'
    };
    
    try {
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(configData)
        });
        
        const data = await response.json();
        setButtonsState(false);
        
        if (data.success) {
            showAlert('success', 'Configurações salvas com sucesso!');
        } else {
            showAlert('error', `Falha ao salvar: ${data.error || 'Erro desconhecido.'}`);
        }
    } catch (err) {
        setButtonsState(false);
        console.error('Erro ao salvar configuracoes:', err);
        showAlert('error', 'Ocorreu um erro ao tentar enviar as configurações para o servidor.');
    }
}

// Event Listeners - Login Section
if (loginValidateBtn) {
    loginValidateBtn.addEventListener('click', validateSchool);
}

// Event Listeners - Config Section
testBtn.addEventListener('click', testConnection);
saveBtn.addEventListener('click', saveConfig);
themeSelect.addEventListener('change', (e) => {
    applyTheme(e.target.value);
});

// Botão de Copiar Código do Widget
const copyWidgetCodeBtn = document.getElementById('copyWidgetCodeBtn');
if (copyWidgetCodeBtn) {
    copyWidgetCodeBtn.addEventListener('click', () => {
        const embedBox = document.querySelector('.code-box-embed');
        if (embedBox) {
            navigator.clipboard.writeText(embedBox.textContent.trim()).then(() => {
                const originalHtml = copyWidgetCodeBtn.innerHTML;
                copyWidgetCodeBtn.innerHTML = '<span>✅ Copiado!</span>';
                copyWidgetCodeBtn.classList.add('btn-success-feedback');
                setTimeout(() => {
                    copyWidgetCodeBtn.innerHTML = originalHtml;
                    copyWidgetCodeBtn.classList.remove('btn-success-feedback');
                }, 2000);
            }).catch(err => {
                console.error('Erro ao copiar código:', err);
                showAlert('error', 'Falha ao copiar o código.');
            });
        }
    });
}

if (atendimentoNumero) {
    atendimentoNumero.addEventListener('input', (e) => {
        const start = e.target.selectionStart;
        const originalLen = e.target.value.length;
        
        const formatted = formatPhone(e.target.value);
        e.target.value = formatted;
        
        const newLen = formatted.length;
        e.target.selectionStart = e.target.selectionEnd = start + (newLen - originalLen);
    });
}

// Lógica de abertura/fechamento do seletor de Emojis
const emojiPicker = document.getElementById('emojiPicker');

botEmoji.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!hash) return;
    emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'flex' : 'none';
});

document.querySelectorAll('.emoji-option').forEach(option => {
    option.addEventListener('click', (e) => {
        botEmoji.value = option.textContent;
        emojiPicker.style.display = 'none';
    });
});

document.addEventListener('click', (e) => {
    if (emojiPicker && !botEmoji.contains(e.target) && !emojiPicker.contains(e.target)) {
        emojiPicker.style.display = 'none';
    }
});

// --- WHATSAPP INTEGRAÇÃO NO FRONT ---
const waStatusText = document.getElementById('waStatusText');
const waQrContainer = document.getElementById('waQrContainer');
const waQrImage = document.getElementById('waQrImage');
const waIconContainer = document.getElementById('waIconContainer');
const waDisconnectBtn = document.getElementById('waDisconnectBtn');
const waRefreshBtn = document.getElementById('waRefreshBtn');

async function checkWhatsAppStatus() {
    if (!hash) return;
    try {
        const response = await fetch(`/api/whatsapp/status?hash=${hash}`);
        const data = await response.json();
        
        if (data.status === 'INITIALIZING') {
            waStatusText.textContent = 'Inicializando WhatsApp...';
            waStatusText.style.color = 'var(--text-primary)';
            waQrContainer.style.display = 'none';
            waIconContainer.style.display = 'block';
            waIconContainer.textContent = '⏳';
            waDisconnectBtn.style.display = 'none';
        } else if (data.status === 'QR_READY') {
            waStatusText.textContent = 'Aguardando leitura do QR Code... Se já conectou no celular, aguarde.';
            waStatusText.style.color = '#d97706'; // amber
            
            if (data.qr) {
                waQrImage.src = data.qr;
                waQrContainer.style.display = 'block';
                waIconContainer.style.display = 'none';
            } else {
                waQrContainer.style.display = 'none';
                waIconContainer.style.display = 'block';
                waIconContainer.textContent = '⏳';
            }
            waDisconnectBtn.style.display = 'none';
        } else if (data.status === 'CONNECTED') {
            let infoText = 'WhatsApp Conectado! Chatbot ativo.';
            if (data.info && data.info.pushname) {
                infoText = `Conectado como: <strong>${data.info.pushname}</strong> (${data.info.wid || ''})`;
            }
            waStatusText.innerHTML = infoText;
            waStatusText.style.color = '#059669'; // green/emerald
            waQrContainer.style.display = 'none';
            waIconContainer.style.display = 'block';
            waIconContainer.textContent = '✅';
            waDisconnectBtn.style.display = 'inline-block';
        } else {
            waStatusText.textContent = 'Desconectado';
            waStatusText.style.color = '#ef4444'; // red
            waQrContainer.style.display = 'none';
            waIconContainer.style.display = 'block';
            waIconContainer.textContent = '❌';
            waDisconnectBtn.style.display = 'none';
        }
    } catch (err) {
        console.error('Erro ao verificar status do WhatsApp:', err);
    }
}

// Desconectar o WhatsApp
waDisconnectBtn.addEventListener('click', () => {
    if (!hash) return;
    showCustomModal({
        title: 'Desconectar WhatsApp',
        message: 'Deseja realmente desconectar este WhatsApp? Isso pausará o chatbot de responder a novas mensagens de WhatsApp.',
        icon: '⚠️',
        isConfirm: true,
        onConfirm: async () => {
            waDisconnectBtn.disabled = true;
            waStatusText.textContent = 'Desconectando...';
            try {
                const response = await fetch('/api/whatsapp/disconnect', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hash })
                });
                await response.json();
                waDisconnectBtn.disabled = false;
                checkWhatsAppStatus();
            } catch (err) {
                waDisconnectBtn.disabled = false;
                console.error('Erro ao desconectar WhatsApp:', err);
                showCustomModal({ title: 'Erro', message: 'Falha ao desconectar o WhatsApp.', icon: '❌' });
            }
        }
    });
});

// Atualizar status manualmente com cooldown de 60 segundos
if (waRefreshBtn) {
    waRefreshBtn.addEventListener('click', async () => {
        const span = waRefreshBtn.querySelector('span') || waRefreshBtn;
        const originalText = span.innerHTML;
        
        waRefreshBtn.disabled = true;
        span.innerHTML = '⏳ Atualizando...';
        
        await checkWhatsAppStatus();
        
        let cooldown = 60;
        span.innerHTML = `⏳ Aguarde (${cooldown}s)`;
        
        const timer = setInterval(() => {
            cooldown--;
            if (cooldown <= 0) {
                clearInterval(timer);
                span.innerHTML = originalText;
                waRefreshBtn.disabled = false;
            } else {
                span.innerHTML = `⏳ Aguarde (${cooldown}s)`;
            }
        }, 1000);
    });
}

// Inicializa na abertura da pagina
window.onload = () => {
    setupPageFlow();
};
