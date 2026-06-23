const USERS = {
    admin: { password: 'admin123', role: 'admin', name: 'Admin' },
    arshil: { password: 'arshil123', role: 'kasir', name: 'Arshil' },
    arinal: { password: 'arinal123', role: 'kasir', name: 'Arinal' },
    dewo: { password: 'dewo123', role: 'kasir', name: 'Dewo' },
};

const sessions = {};

function generateToken() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function login(username, password) {
    const user = USERS[username.toLowerCase()];
    if (!user || user.password !== password) return null;
    const token = generateToken();
    sessions[token] = { username: username.toLowerCase(), role: user.role, name: user.name };
    return token;
}

function getSession(token) {
    return sessions[token] || null;
}

function logout(token) {
    delete sessions[token];
}

module.exports = { login, getSession, logout };
