// script.js
const APP_ID = 66842;
let currentAccounts = [];
let activeCopies = new Map();
let masterAccount = null;
let ws;

const derivWS = {
    conn: null,
    reqId: 1,

    connect: function(token) {
        this.conn = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        
        this.conn.onopen = () => {
            log('🔌 WebSocket connected', 'success');
            this.authorize(token);
        };

        this.conn.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
        this.conn.onerror = (e) => log(`⚠️ WebSocket error: ${e.message}`, 'error');
    },

    authorize: function(token) {
        this.send({ authorize: token });
    },

    send: function(data) {
        if(this.conn.readyState === WebSocket.OPEN) {
            data.req_id = this.reqId++;
            this.conn.send(JSON.stringify(data));
            log(`📤 Sent: ${JSON.stringify(data)}`, 'info');
        }
    },

    handleMessage: function(response) {
        if(response.error) {
            log(`❌ Error: ${response.error.message}`, 'error');
            return;
        }

        if(response.authorize) {
            handleAuthorization(response);
        } else if(response.copy_start) {
            handleCopyStart(response);
        } else if(response.copy_stop) {
            handleCopyStop(response);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const tokens = parseTokensFromURL(params);
    
    if(tokens.length === 0) {
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
    
    while(params.get(`acct${i}`)) {
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
    if(!token) {
        log('⚠️ Please enter master token', 'error');
        return;
    }

    const tempWS = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    tempWS.onopen = () => tempWS.send(JSON.stringify({ authorize: token }));
    
    tempWS.onmessage = (e) => {
        const response = JSON.parse(e.data);
        if(response.authorize) {
            masterAccount = {
                id: response.authorize.loginid,
                currency: response.authorize.currency,
                balance: response.authorize.balance
            };
            updateMasterUI();
            log('🔓 Master authenticated successfully', 'success');
        } else if(response.error) {
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

function handleCopyAction(accountId) {
    const account = currentAccounts.find(acc => acc.id === accountId);
    
    if(account.currency !== masterAccount.currency) {
        log(`❌ Currency mismatch: ${account.currency} vs ${masterAccount.currency}`, 'error');
        return;
    }

    if(activeCopies.has(accountId)) {
        derivWS.send({ copy_stop: activeCopies.get(accountId) });
    } else {
        derivWS.send({
            "copy_start": "masterAccount.token",
            "loginid": "accountId"
        });
    }
}

function handleCopyStart(response) {
    activeCopies.set(response.echo_req.loginid, response.copy_start);
    setupAccountsUI();
    log('📈 Copy trading started successfully', 'success');
}

function handleCopyStop(response) {
    activeCopies.delete(response.echo_req.loginid);
    setupAccountsUI();
    log('📉 Copy trading stopped', 'info');
}

function deleteMaster() {
    masterAccount = null;
    document.getElementById('masterInfo').innerHTML = '';
    setupAccountsUI();
    log('🗑️ Master account removed', 'info');
}

function logout() {
    activeCopies.forEach((_, accountId) => {
        derivWS.send({ copy_stop: accountId });
    });
    window.location.href = 'index.html';
}

function log(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `
        <span>${new Date().toLocaleTimeString()}</span>
        <span>${message}</span>
    `;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}
