const APP_ID = 66842;
let currentAccounts = [];
let activeCopies = new Map();
let masterAccount = null;

const derivWS = {
    conn: null,
    reqId: 1,
    currentToken: null,

    connect: function(token) {
        this.currentToken = token;
        if (this.conn) this.conn.close();
        
        this.conn = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        
        this.conn.onopen = () => {
            log('🔌 WebSocket connected', 'success');
            this.authorize(token);
            this.startPing();
        };

        this.conn.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
        this.conn.onerror = (e) => log(`⚠️ WebSocket error: ${e.message}`, 'error');
    },

    authorize: function(token) {
        this.currentToken = token;
        this.send({ authorize: token });
    },

    send: function(data) {
        if (this.conn.readyState === WebSocket.OPEN) {
            data.req_id = this.reqId++;
            this.conn.send(JSON.stringify(data));
            log(`📤 Sent: ${JSON.stringify(data, null, 2)}`, 'info', data);
        }
    },

    handleMessage: function(response) {
        log(`📥 Received: ${JSON.stringify(response, null, 2)}`, 'info', response);
        
        if (response.error) {
            log(`❌ Error: ${response.error.message}`, 'error');
            return;
        }

        if (response.authorize) {
            handleAuthorization(response);
        } else if (response.copy_start) {
            handleCopyStart(response);
        } else if (response.copy_stop) {
            handleCopyStop(response);
        } else if (response.pong) {
            log('🏓 Received pong', 'info');
        }
    },

    startPing: function() {
        setInterval(() => {
            if (this.conn.readyState === WebSocket.OPEN) {
                this.send({ ping: 1 });
            }
        }, 30000);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const tokens = parseTokensFromURL(params);
    
    if (tokens.length === 0) {
        log('⚠️ No valid accounts found', 'error');
        return;
    }

    currentAccounts = tokens;
    setupAccountsUI();
    derivWS.connect(tokens[0].token);
});

function parseTokensFromURL(params) {
    const accounts = [];
    let i = 1;
    
    while (params.get(`acct${i}`)) {
        accounts.push({
            id: params.get(`acct${i}`),
            token: params.get(`token${i}`),
            currency: params.get(`cur${i}`),
            balance: 'Loading...'
        });
        i++;
    }
    
    return accounts;
}

function setupAccountsUI() {
    const container = document.getElementById('accountsContainer');
    container.innerHTML = currentAccounts.map(acc => `
        <div class="account-card">
            <h3>💰 ${acc.id}</h3>
            <p>${acc.currency.toUpperCase()} - ${acc.balance}</p>
            <button class="copy-btn" onclick="handleCopyAction('${acc.id}')" 
                ${!masterAccount ? 'disabled' : ''}>
                ${activeCopies.has(acc.id) ? '🛑 Stop Copy' : '📋 Start Copy'}
            </button>
        </div>
    `).join('');
}

function authenticateMaster() {
    const token = document.getElementById('masterToken').value;
    if (!token) {
        log('⚠️ Please enter master token', 'error');
        return;
    }

    const tempWS = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    tempWS.onopen = () => tempWS.send(JSON.stringify({ authorize: token }));
    
    tempWS.onmessage = (e) => {
        const response = JSON.parse(e.data);
        if (response.authorize) {
            masterAccount = {
                id: response.authorize.loginid,
                currency: response.authorize.currency,
                balance: response.authorize.balance,
                token: token
            };
            updateMasterUI();
            log('🔓 Master authenticated successfully', 'success');
        } else if (response.error) {
            log(`❌ Master auth failed: ${response.error.message}`, 'error');
        }
        tempWS.close();
    };
}

function updateMasterUI() {
    const masterInfo = document.getElementById('masterInfo');
    masterInfo.innerHTML = `
        <h2>👑 Master Account</h2>
        <p>ID: ${masterAccount.id}</p>
        <p>Currency: ${masterAccount.currency}</p>
        <p>Balance: ${masterAccount.balance}</p>
        <button class="delete-btn" onclick="deleteMaster()">🗑️ Remove Master</button>
    `;
    setupAccountsUI();
}

async function handleCopyAction(accountId) {
    const account = currentAccounts.find(acc => acc.id === accountId);
    if (!account) return;

    if (derivWS.currentToken !== masterAccount.token) {
        await new Promise((resolve) => {
            const authHandler = (e) => {
                const response = JSON.parse(e.data);
                if (response.authorize?.loginid === masterAccount.id) {
                    derivWS.conn.removeEventListener('message', authHandler);
                    resolve();
                }
            };
            derivWS.conn.addEventListener('message', authHandler);
            derivWS.authorize(masterAccount.token);
        });
    }

    if (account.currency !== masterAccount.currency) {
        log(`❌ Currency mismatch: ${account.currency} vs ${masterAccount.currency}`, 'error');
        return;
    }

    if (activeCopies.has(accountId)) {
        derivWS.send({
            copy_stop: account.token,  // ✅ FIX: Use client's stored API token
            loginid: accountId
        });
    } else {
        derivWS.send({
            copy_start: masterAccount.token,
            loginid: accountId
        });
    }
}

function handleCopyStart(response) {
    if (response.msg_type === 'copy_start' && response.copy_start === 1) {
        activeCopies.set(response.echo_req.loginid, response.echo_req.copy_start);
        setupAccountsUI();
        log(`📈 Copy started for ${response.echo_req.loginid}`, 'success');
    } else {
        log(`❌ Copy start failed: ${response.error?.message || 'Unknown error'}`, 'error');
    }
}

function handleCopyStop(response) {
    if (response.msg_type === 'copy_stop' && response.copy_stop === 1) {
        activeCopies.delete(response.echo_req.loginid);
        setupAccountsUI();
        log(`📉 Copy stopped for ${response.echo_req.loginid}`, 'info');
    } else {
        log(`❌ Copy stop failed: ${response.error?.message || 'Unknown error'}`, 'error');
    }
}

function deleteMaster() {
    masterAccount = null;
    document.getElementById('masterInfo').innerHTML = '';
    setupAccountsUI();
    log('🗑️ Master account removed', 'info');
}

function logout() {
    activeCopies.forEach((_, accountId) => {
        const account = currentAccounts.find(acc => acc.id === accountId);
        if (account) {
            derivWS.send({ copy_stop: account.token });  // ✅ FIX: Use correct token for stopping copy
        }
    });

    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1000);
}

function log(message, type = 'info', data = null) {
    const logContainer = document.getElementById('logContainer');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    
    let content = `[${new Date().toLocaleTimeString()}] ${message}`;
    if (data) {
        content += `<div class="log-data">${JSON.stringify(data, null, 2)}</div>`;
    }

    entry.innerHTML = content;
    
    if (logContainer.children.length > 50) {
        logContainer.removeChild(logContainer.firstChild);
    }
    
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}
