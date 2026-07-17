if (window.location.search.includes('iframe=true') || window.self !== window.top) {
    document.body.classList.add('iframe-mode');
}

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

// Gerador simples de Session ID ou recuperador do sessionStorage
let sessionId = sessionStorage.getItem('chatbot_session_id');
if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('chatbot_session_id', sessionId);
}

const urlParams = new URLSearchParams(window.location.search);
const hash = urlParams.get('hash') || '';

const chatLog = document.getElementById('chatLog');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');

// Parser simples para formatar Markdown na interface do chat (negrito, links e codigo)
function parseMarkdown(text) {
    // Escapar tags HTML básicas
    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    
    // Restaura tags de imagem seguras (data url base64)
    html = html.replace(/&lt;img src="data:image\/(png|jpeg|jpg|gif);base64,([\s\S]*?)" style="([\s\S]*?)" \/&gt;/g, '<img src="data:image/$1;base64,$2" style="$3" />');

    // Negrito: **texto**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Monospaçado / Código: `texto`
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    
    // Links: [texto](url)
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // Quebras de linha
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

function appendMessage(sender, text, options = null, isIdentified = false, extraButtons = null) {
    const messageDiv = document.createElement('div');
    if (sender === 'blocked-bot') {
        messageDiv.classList.add('message', 'bot', 'blocked-bot');
    } else {
        messageDiv.classList.add('message', sender);
    }
    messageDiv.innerHTML = parseMarkdown(text);
    
    // Adiciona botões interativos se for a saudação inicial ou incluir opções
    if (sender === 'bot') {
        const optionsDiv = document.createElement('div');
        optionsDiv.classList.add('options-container');
        
        if (options && Array.isArray(options) && options.length > 0) {
            options.forEach((opt, idx) => {
                const btn = document.createElement('button');
                btn.classList.add('option-btn');
                btn.innerHTML = `${idx + 1} - ${opt.label}`;
                btn.onclick = () => {
                    if (opt.url) {
                        window.open(opt.url, '_blank');
                    } else if (opt.id === 'sair') {
                        sendQuickMessage('Sair');
                    } else {
                        sendQuickMessage(String(idx + 1));
                    }
                };
                optionsDiv.appendChild(btn);
            });
        }

        // Determina se deve mostrar o botão Sair
        const isInitialGreeting = (!isIdentified && options && options.length > 0);
        if (!isInitialGreeting) {
            const exitBtn = document.createElement('button');
            exitBtn.classList.add('option-btn');
            exitBtn.style.border = '1px dashed rgba(220, 38, 38, 0.3)';
            exitBtn.innerHTML = '❌ Sair';
            exitBtn.onclick = () => sendQuickMessage('Sair');
            optionsDiv.appendChild(exitBtn);
        }
        
        messageDiv.appendChild(optionsDiv);
    }
    
    chatLog.appendChild(messageDiv);
    chatLog.scrollTop = 0;
}

// Mostra o indicador de digitação do Bot
let typingIndicator = null;
function showTypingIndicator() {
    if (typingIndicator) return;
    
    typingIndicator = document.createElement('div');
    typingIndicator.classList.add('message', 'bot');
    
    const indicatorContent = document.createElement('div');
    indicatorContent.classList.add('typing-indicator');
    indicatorContent.innerHTML = `
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
    `;
    
    typingIndicator.appendChild(indicatorContent);
    chatLog.appendChild(typingIndicator);
    chatLog.scrollTop = 0;
}

// Remove o indicador de digitação do Bot
function removeTypingIndicator() {
    if (typingIndicator) {
        typingIndicator.remove();
        typingIndicator = null;
    }
}

// Envia uma mensagem digitada pelo usuário
async function sendMessage(textToSend = null) {
    const text = textToSend || userInput.value;
    if (!text.trim()) return;
    
    if (!textToSend) {
        userInput.value = '';
    }
    
    const cleanText = text.trim().toLowerCase();
    const isExit = (cleanText === 'sair' || cleanText === 'limpar' || cleanText === 'novo' || cleanText === 'menu');
    
    if (isExit) {
        chatLog.innerHTML = '';
    } else {
        // Exibe a mensagem do usuário no log
        appendMessage('user', text);
    }
    
    // Mostra indicador de digitação
    showTypingIndicator();
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: sessionId,
                message: text,
                hash: hash
            })
        });
        
        const data = await response.json();
        removeTypingIndicator();
        
        if (data.response) {
            appendMessage('bot', data.response, data.options, data.isIdentified, data.extraButtons);
        } else {
            appendMessage('bot', 'Desculpe, recebi uma resposta vazia do servidor.');
        }

        if (data.redirectUrl) {
            window.open(data.redirectUrl, '_blank');
        }
    } catch (err) {
        removeTypingIndicator();
        console.error('Erro ao enviar mensagem:', err);
        appendMessage('bot', 'Ops, tive problemas para me conectar com o servidor. Verifique sua conexão e tente novamente.');
    }
}

// Envia uma mensagem rápida via clique de botão
function sendQuickMessage(text) {
    sendMessage(text);
}

// Aplica as informações dinâmicas do Bot (título, emoji, logo e tema) na interface do chat
function applyBotInfo(infoData) {
    if (!infoData) return;
    if (infoData.title) {
        const titleEl = document.querySelector('.header-title h1');
        if (titleEl) titleEl.textContent = infoData.title;
        document.title = infoData.title;
    }
    const headerLogoEl = document.querySelector('.header-logo');
    if (headerLogoEl) {
        if (infoData.logo) {
            headerLogoEl.style.display = 'none';
            let customLogo = document.querySelector('.header-custom-logo');
            if (!customLogo) {
                customLogo = document.createElement('img');
                customLogo.className = 'header-custom-logo';
                customLogo.style.height = '40px';
                customLogo.style.width = 'auto';
                customLogo.style.objectFit = 'contain';
                customLogo.style.marginRight = '12px';
                headerLogoEl.parentNode.insertBefore(customLogo, headerLogoEl.nextSibling);
            }
            customLogo.src = infoData.logo;
            customLogo.style.display = 'block';
        } else {
            headerLogoEl.style.display = 'flex';
            if (infoData.emoji) {
                headerLogoEl.textContent = infoData.emoji;
            }
            const customLogo = document.querySelector('.header-custom-logo');
            if (customLogo) {
                customLogo.style.display = 'none';
            }
        }
    }
    if (infoData.theme) {
        applyTheme(infoData.theme);
    }
}

function applyBlockedState(infoData) {
    removeTypingIndicator();
    chatLog.innerHTML = '';
    
    // Altera o status para "Offline" no header
    const statusEl = document.querySelector('.header-title p');
    if (statusEl) {
        statusEl.textContent = 'Offline';
        statusEl.style.color = '#ef4444'; // Vermelho para indicar offline
    }
    
    // Adiciona a mensagem offline do bot sem opções ou botões
    appendMessage('blocked-bot', infoData.blockedMessage || 'Ops, estou sem conexão. Tente novamente mais tarde. Para casos urgentes, entre em contato direto com a escola.');
    
    // Oculta a área de input
    const inputArea = document.querySelector('.input-area');
    if (inputArea) {
        inputArea.style.display = 'none';
    }
}

// Inicializa a conversa com a saudação inicial do chatbot
async function initChat() {
    showTypingIndicator();
    
    // Tenta carregar imediatamente do cache local para evitar piscadas
    const cacheKey = `bot_info_${hash}`;
    const cachedInfo = localStorage.getItem(cacheKey);
    let wasBlockedCached = false;
    if (cachedInfo) {
        try {
            const parsed = JSON.parse(cachedInfo);
            applyBotInfo(parsed);
            if (parsed.blocked) {
                wasBlockedCached = true;
                applyBlockedState(parsed);
            }
        } catch (e) {
            console.error('Erro ao ler cache do bot info:', e);
        }
    }
    
    let infoData = null;
    try {
        const infoRes = await fetch(`/api/info?hash=${hash}`);
        infoData = await infoRes.json();
        localStorage.setItem(cacheKey, JSON.stringify(infoData));
        applyBotInfo(infoData);

        if (infoData.blocked) {
            applyBlockedState(infoData);
            return;
        } else {
            // Se estava bloqueado no cache mas agora está liberado, restaura os elementos
            const inputArea = document.querySelector('.input-area');
            if (inputArea) inputArea.style.display = 'flex';
            const statusEl = document.querySelector('.header-title p');
            if (statusEl) {
                statusEl.textContent = 'Online';
                statusEl.style.color = '';
            }
        }
    } catch (err) {
        console.error('Erro ao carregar informações do bot:', err);
        if (wasBlockedCached) return;
    }

    try {
        const chatRes = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: sessionId,
                message: 'menu',
                hash: hash
            })
        });
        const data = await chatRes.json();
        removeTypingIndicator();
        if (data.response) {
            appendMessage('bot', data.response, data.options, data.isIdentified, data.extraButtons);
        }
    } catch (err) {
        removeTypingIndicator();
        console.error('Erro ao inicializar chat:', err);
        appendMessage('bot', 'Olá! Seja bem-vindo. Por favor, envie uma mensagem para começar.');
    }
}

// Event Listeners
sendBtn.addEventListener('click', () => sendMessage());
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Inicialização automática ao carregar a página
window.onload = initChat;
