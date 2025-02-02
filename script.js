const APP_ID = 66842;
let currentAccounts = [];
let activeCopies = new Map();
let masterAccount = null;
let ws;

const derivWS = {
    conn: null,
    reqId: 1,
    currentToken: null,

    connect: function(token) {
        this.currentToken = token;
        if(this.conn) this.conn.close();
        
        this.conn = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        
        this.conn.onopen = () => {
            log('🔌 WebSocket connected', 'success');
            this.authorize(token);
        };

        this.conn.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
        this.conn.onerror = (e) => log(`⚠️ WebSocket error: ${e.message}`, 'error');
    },

    authorize: function(token) {
        this.currentToken = token;
        this.send({ authorize: token });
    },

    send: function(data) {
        if(this.conn.readyState === WebSocket.OPEN) {
            data.req_id = this.reqId++;
            this.conn.send(JSON.stringify(data));
            log(`📤 Sent: ${JSON.stringify(data, null, 2)}`, 'info', data);
        }
    },

    handleMessage: function(response) {
        log(`📥 Received: ${JSON.stringify(response, null, 2)}`, 'info', response);
        
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
        } else if(response.copytrading_list) {
            handleCopierList(response);
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

async function handleCopyAction(accountId) {
    const account = currentAccounts.find(acc => acc.id === accountId);
    if(!account) return;

    // Switch to target account's token
    if(derivWS.currentToken !== account.token) {
        await new Promise((resolve) => {
            const authHandler = (e) => {
                const response = JSON.parse(e.data);
                if(response.authorize?.loginid === accountId) {
                    derivWS.conn.removeEventListener('message', authHandler);
                    resolve();
                }
            };
            derivWS.conn.addEventListener('message', authHandler);
            derivWS.authorize(account.token);
        });
    }

    // Verify currency match
    if(account.currency !== masterAccount.currency) {
        log(`❌ Currency mismatch: ${account.currency} vs ${masterAccount.currency}`, 'error');
        return;
    }

    // Send copy request
    if(activeCopies.has(accountId)) {
        derivWS.send({ copy_stop: activeCopies.get(accountId) });
    } else {
        derivWS.send({
            copy_start: masterAccount.token,
            loginid: accountId,
            assets: ["*"], // Allow all assets
            trade_types: ["*"], // Allow all trade types
            min_trade_stake: 1 // Set your minimum stake
        });
    }
}

function handleCopyStart(response) {
    if(response.msg_type === 'copy_start') {
        activeCopies.set(response.echo_req.loginid, response.copy_start);
        setupAccountsUI();
        log(`📈 Copy started for ${response.echo_req.loginid}`, 'success');
    } else {
        log(`❌ Copy start failed: ${response.error?.message || 'Unknown error'}`, 'error');
    }
}

function handleCopyStop(response) {
    if(response.msg_type === 'copy_stop') {
        activeCopies.delete(response.echo_req.loginid);
        setupAccountsUI();
        log(`📉 Copy stopped for ${response.echo_req.loginid}`, 'info');
    } else {
        log(`❌ Copy stop failed: ${response.error?.message || 'Unknown error'}`, 'error');
    }
}

function log(message, type = 'info', data = null) {
    const logContainer = document.getElementById('logContainer');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    
    let content = `[${new Date().toLocaleTimeString()}] ${message}`;
    if(data) {
        content += `<div class="log-data">${JSON.stringify(data, null, 2)}</div>`;
    }

    entry.innerHTML = content;
    
    if(logContainer.children.length > 50) {
        logContainer.removeChild(logContainer.firstChild);
    }
    
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// Add this to your CSS
.log-data {
    background: rgba(255, 255, 255, 0.1);
    padding: 8px;
    border-radius: 4px;
    margin-top: 4px;
    font-family: monospace;
    white-space: pre-wrap;
}
