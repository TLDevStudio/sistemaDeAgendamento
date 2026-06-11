import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, updatePassword as fbUpdatePassword } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, addDoc, getDocs, getDoc, updateDoc, deleteDoc, doc, query, where, orderBy, serverTimestamp, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const savedCfg = (() => { try { return JSON.parse(localStorage.getItem('agendapro_firebase_cfg') || 'null'); } catch (e) { return null; } })();

if (!savedCfg) {
    document.getElementById('appLoader').style.display = 'none';
    document.getElementById('setupScreen').classList.add('show');
}

window.saveFirebaseConfig = function () {
    const cfg = {
        apiKey: document.getElementById('cfg-apiKey').value.trim(),
        authDomain: document.getElementById('cfg-authDomain').value.trim(),
        projectId: document.getElementById('cfg-projectId').value.trim(),
        appId: document.getElementById('cfg-appId').value.trim(),
        storageBucket: document.getElementById('cfg-authDomain').value.replace('firebaseapp.com', 'appspot.com'),
        messagingSenderId: ''
    };
    if (!cfg.apiKey || !cfg.authDomain || !cfg.projectId || !cfg.appId) {
        showToast('Preencha todos os campos', 'error'); return;
    }
    localStorage.setItem('agendapro_firebase_cfg', JSON.stringify(cfg));
    showToast('Configuração salva! Recarregando...', 'success');
    setTimeout(() => location.reload(), 1200);
};

window.switchFirebaseConfig = function () {
    document.getElementById('authScreen').classList.remove('show');
    document.getElementById('setupScreen').classList.add('show');
};

if (!savedCfg) { window.initApp = () => { }; } else {
    let app, auth, db;
    try {
        app = initializeApp(savedCfg);
        auth = getAuth(app);
        db = getFirestore(app);
    } catch (e) {
        document.getElementById('appLoader').style.display = 'none';
        document.getElementById('setupScreen').classList.add('show');
        showToast('Erro na configuração Firebase. Reconfigure.', 'error');
    }

    let currentUser = null;
    let currentRole = 'client';
    let currentUserDoc = null;
    let SERVICES = [];
    let EMPLOYEES = [];
    let CLIENTS = [];
    let APPOINTMENTS = [];
    let NOTIFICATIONS = [];
    let SETTINGS_DOC = {};
    let HOURS_CONFIG = [
        { day: 'Segunda', open: true, start: '09:00', end: '19:00' },
        { day: 'Terça', open: true, start: '09:00', end: '19:00' },
        { day: 'Quarta', open: true, start: '09:00', end: '19:00' },
        { day: 'Quinta', open: true, start: '09:00', end: '19:00' },
        { day: 'Sexta', open: true, start: '09:00', end: '19:00' },
        { day: 'Sábado', open: true, start: '09:00', end: '17:00' },
        { day: 'Domingo', open: false, start: '', end: '' },
    ];

    let booking = { step: 1, service: null, pro: null, date: null, time: null };
    let calPickerDate = { m: new Date().getMonth(), y: new Date().getFullYear() };
    let agendaView = 'week';
    let currentPeriod = new Date();
    const AVATAR_COLORS = ['ua-violet', 'ua-mint', 'ua-amber', 'ua-rose', 'ua-sky'];

    function getInitials(name = '') {
        const parts = name.trim().split(' ').filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        return (name.slice(0, 2)).toUpperCase();
    }
    function getAvatarClass(name = '') {
        let hash = 0; for (let c of name) hash += c.charCodeAt(0);
        return AVATAR_COLORS[hash % AVATAR_COLORS.length];
    }
    function fmtCurrency(v) { return 'R$\u00a0' + Number(v || 0).toFixed(2).replace('.', ','); }
    function fmtDate(d) {
        if (!d) return '—';
        const dt = d.toDate ? d.toDate() : new Date(d);
        return dt.toLocaleDateString('pt-BR');
    }
    function fmtDateShort(dt) {
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        return `${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
    }

    onAuthStateChanged(auth, async (user) => {
        document.getElementById('appLoader').style.display = 'none';
        if (user) {
            currentUser = user;
            try {
                const udoc = await getDoc(doc(db, 'users', user.uid));
                currentUserDoc = udoc.exists() ? udoc.data() : { role: 'client', name: user.email };
                currentRole = currentUserDoc.role || 'client';
            } catch (e) { currentRole = 'client'; currentUserDoc = { role: 'client', name: user.email }; }

            document.getElementById('authScreen').classList.remove('show');
            document.getElementById('mainApp').classList.add('show');
            setupUI();
            loadAllData();
        } else {
            currentUser = null;
            document.getElementById('mainApp').classList.remove('show');
            document.getElementById('authScreen').classList.add('show');
        }
    });

    window.switchAuthTab = function (tab) {
        document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
        document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
        document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
        document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
        document.getElementById('authError').classList.remove('show');
    };

    window.doLogin = async function () {
        const email = document.getElementById('loginEmail').value.trim();
        const pass = document.getElementById('loginPassword').value;
        const errEl = document.getElementById('authError');
        if (!email || !pass) { errEl.textContent = 'Preencha e-mail e senha'; errEl.classList.add('show'); return; }
        const btn = document.getElementById('btnLogin');
        btn.disabled = true; btn.textContent = 'Entrando...';
        try {
            await signInWithEmailAndPassword(auth, email, pass);
        } catch (e) {
            const msgs = { 'auth/user-not-found': 'Usuário não encontrado.', 'auth/wrong-password': 'Senha incorreta.', 'auth/invalid-email': 'E-mail inválido.', 'auth/too-many-requests': 'Muitas tentativas. Tente mais tarde.', 'auth/invalid-credential': 'E-mail ou senha incorretos.' };
            errEl.textContent = msgs[e.code] || 'Erro ao fazer login. Tente novamente.';
            errEl.classList.add('show');
        } finally { btn.disabled = false; btn.innerHTML = '<i class="ti ti-login"></i> Entrar'; }
    };

    window.doRegister = async function () {
        const nome = document.getElementById('regNome').value.trim();
        const sobrenome = document.getElementById('regSobrenome').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const tel = document.getElementById('regTelefone').value.trim();
        const pass = document.getElementById('regSenha').value;
        const conf = document.getElementById('regSenhaConf').value;
        const errEl = document.getElementById('authError');
        if (!nome || !email || !pass) { errEl.textContent = 'Preencha os campos obrigatórios'; errEl.classList.add('show'); return; }
        if (pass !== conf) { errEl.textContent = 'As senhas não coincidem'; errEl.classList.add('show'); return; }
        if (pass.length < 6) { errEl.textContent = 'A senha deve ter pelo menos 6 caracteres'; errEl.classList.add('show'); return; }
        const btn = document.getElementById('btnRegister');
        btn.disabled = true; btn.textContent = 'Criando conta...';
        try {
            const cred = await createUserWithEmailAndPassword(auth, email, pass);
            const allUsers = await getDocs(collection(db, 'users'));
            const role = allUsers.empty ? 'admin' : 'client';
            await setDoc(doc(db, 'users', cred.user.uid), {
                name: `${nome} ${sobrenome}`.trim(), email, phone: tel, role,
                createdAt: serverTimestamp()
            });
        } catch (e) {
            const msgs = { 'auth/email-already-in-use': 'Este e-mail já está cadastrado.', 'auth/invalid-email': 'E-mail inválido.', 'auth/weak-password': 'Senha muito fraca.' };
            errEl.textContent = msgs[e.code] || 'Erro ao criar conta.';
            errEl.classList.add('show');
        } finally { btn.disabled = false; btn.innerHTML = '<i class="ti ti-user-plus"></i> Criar conta'; }
    };

    window.doLogout = async function () {
        await signOut(auth);
        showToast('Sessão encerrada', 'info');
    };

    window.doResetPassword = async function () {
        const email = document.getElementById('loginEmail').value.trim();
        if (!email) { showToast('Digite seu e-mail para recuperar a senha', 'error'); return; }
        try {
            await sendPasswordResetEmail(auth, email);
            showToast('E-mail de recuperação enviado!', 'success');
        } catch (e) { showToast('Erro ao enviar e-mail de recuperação', 'error'); }
    };

    window.updatePassword = async function () {
        const newPass = document.getElementById('newPassword').value;
        if (!newPass || newPass.length < 6) { showToast('A senha deve ter pelo menos 6 caracteres', 'error'); return; }
        try {
            await fbUpdatePassword(currentUser, newPass);
            document.getElementById('newPassword').value = '';
            showToast('Senha alterada com sucesso!', 'success');
        } catch (e) { showToast('Erro ao alterar senha. Faça login novamente.', 'error'); }
    };

    function setupUI() {
        const name = currentUserDoc?.name || currentUser?.email || '';
        const initials = getInitials(name);
        const cls = getAvatarClass(name);
        document.getElementById('sidebarAvatar').textContent = initials;
        document.getElementById('sidebarAvatar').className = `user-avatar ${cls}`;
        document.getElementById('sidebarUserName').textContent = name;
        document.getElementById('sidebarUserRole').textContent = currentRole === 'admin' ? 'Administrador' : 'Cliente';
        document.getElementById('settingsAvatar').textContent = initials;
        document.getElementById('settingsName').textContent = name;
        document.getElementById('settingsEmail').textContent = currentUser.email + ' · ' + (currentRole === 'admin' ? 'Administrador' : 'Cliente');
        document.getElementById('adminNav').style.display = currentRole === 'admin' ? 'block' : 'none';
        document.getElementById('clientNav').style.display = currentRole === 'client' ? 'block' : 'none';

        document.getElementById('portalAvatar').textContent = initials;
        document.getElementById('portalAvatar').className = `user-avatar ${cls}`;
        document.getElementById('portalName').textContent = name;
        document.getElementById('portalEmail').textContent = currentUser.email;
        document.getElementById('portalNameInput').value = name;
        document.getElementById('portalPhone').value = currentUserDoc?.phone || '';

        const h = new Date().getHours();
        const greet = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
        const firstName = name.split(' ')[0];
        document.getElementById('dashGreeting').textContent = `${greet}, ${firstName}! 👋`;
        const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
        const now = new Date();
        document.getElementById('dashDate').textContent = `${days[now.getDay()]}, ${now.getDate()} de ${months[now.getMonth()]} de ${now.getFullYear()}`;

        if (currentRole === 'admin') navigate('dashboard');
        else navigate('clientPortal');
    }

    async function loadAllData() {
        await Promise.all([loadServices(), loadEmployees(), loadClients(), loadAppointments(), loadNotifications(), loadSettings()]);
    }

    async function loadServices() {
        const snap = await getDocs(collection(db, 'services'));
        SERVICES = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    async function loadEmployees() {
        const snap = await getDocs(collection(db, 'employees'));
        EMPLOYEES = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    async function loadClients() {
        const snap = await getDocs(collection(db, 'clients'));
        CLIENTS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    async function loadAppointments() {
        let snap;
        if (currentRole === 'admin') {
            snap = await getDocs(query(collection(db, 'appointments'), orderBy('createdAt', 'desc')));
        } else {
            snap = await getDocs(query(collection(db, 'appointments'), where('clientEmail', '==', currentUser.email)));
        }
        APPOINTMENTS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    async function loadNotifications() {
        const snap = await getDocs(query(collection(db, 'notifications'), orderBy('createdAt', 'desc')));
        NOTIFICATIONS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        updateNotifBadge();
    }
    async function loadSettings() {
        try {
            const sdoc = await getDoc(doc(db, 'settings', 'main'));
            if (sdoc.exists()) {
                SETTINGS_DOC = sdoc.data();
                if (SETTINGS_DOC.hours) HOURS_CONFIG = SETTINGS_DOC.hours;
                const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
                f('cfgNomeEmpresa', SETTINGS_DOC.nomeEmpresa);
                f('cfgTelEmpresa', SETTINGS_DOC.telEmpresa);
                f('cfgEndEmpresa', SETTINGS_DOC.endEmpresa);
                f('cfgInstagram', SETTINGS_DOC.instagram);
                f('cfgWhatsapp', SETTINGS_DOC.whatsapp);
                f('cfgSobre', SETTINGS_DOC.sobre);
            }
        } catch (e) { }
    }

    const pageTitles = { dashboard: 'Dashboard', agenda: 'Agenda', booking: 'Novo Agendamento', services: 'Serviços', team: 'Equipe', clients: 'Clientes', reports: 'Relatórios', notifications: 'Notificações', settings: 'Configurações', clientPortal: 'Minha Área' };

    window.navigate = async function (page) {
        document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const target = document.getElementById('page-' + page);
        if (target) target.classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(n => {
            if (n.getAttribute('onclick')?.includes("'" + page + "'")) n.classList.add('active');
        });
        document.getElementById('topbarTitle').textContent = pageTitles[page] || page;

        if (page === 'dashboard') await renderDashboard();
        if (page === 'agenda') { renderAgenda(); }
        if (page === 'services') await renderServices();
        if (page === 'team') await renderTeam();
        if (page === 'clients') await renderClients();
        if (page === 'booking') await initBooking();
        if (page === 'reports') await renderReports();
        if (page === 'notifications') renderNotifications();
        if (page === 'settings') renderHoursEditor();
        if (page === 'clientPortal') await renderClientPortal();
    };

    async function renderDashboard() {
        await loadAppointments();
        const today = new Date();
        const todayStr = today.toDateString();
        const thisMonth = today.getMonth();
        const thisYear = today.getFullYear();

        const todayAppts = APPOINTMENTS.filter(a => {
            if (!a.date) return false;
            const d = a.date.toDate ? a.date.toDate() : new Date(a.date);
            return d.toDateString() === todayStr;
        });

        const monthRevenue = APPOINTMENTS.filter(a => {
            if (!a.date || a.status === 'cancelado') return false;
            const d = a.date.toDate ? a.date.toDate() : new Date(a.date);
            return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
        }).reduce((sum, a) => sum + (Number(a.price) || 0), 0);

        const monthCancels = APPOINTMENTS.filter(a => {
            if (!a.date) return false;
            const d = a.date.toDate ? a.date.toDate() : new Date(a.date);
            return d.getMonth() === thisMonth && d.getFullYear() === thisYear && a.status === 'cancelado';
        }).length;

        document.getElementById('statToday').textContent = todayAppts.length;
        document.getElementById('statRevenue').textContent = fmtCurrency(monthRevenue);
        document.getElementById('statClients').textContent = CLIENTS.length;
        document.getElementById('statCancel').textContent = monthCancels;

        const conf = todayAppts.filter(a => a.status === 'confirmado').length;
        const pend = todayAppts.filter(a => a.status === 'pendente').length;
        const inprog = todayAppts.filter(a => a.status === 'em_andamento').length;
        const canc = todayAppts.filter(a => a.status === 'cancelado').length;
        document.getElementById('sumConfirmed').textContent = conf;
        document.getElementById('sumPending').textContent = pend;
        document.getElementById('sumInProgress').textContent = inprog;
        document.getElementById('sumCanceled').textContent = canc;

        const listEl = document.getElementById('todayAppts');
        if (todayAppts.length === 0) {
            listEl.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="ti ti-calendar-off"></i></div><div class="empty-title">Sem agendamentos hoje</div><div class="empty-sub">Use o botão acima para criar um novo agendamento.</div></div>`;
        } else {
            const sorted = [...todayAppts].sort((a, b) => a.time?.localeCompare(b.time || '') || 0);
            listEl.innerHTML = sorted.map(a => {
                const ini = getInitials(a.clientName || '?');
                const cls = getAvatarClass(a.clientName || '');
                const badgeCls = { 'confirmado': 'badge-violet', 'pendente': 'badge-amber', 'em_andamento': 'badge-sky', 'cancelado': 'badge-rose', 'concluido': 'badge-mint' }[a.status] || 'badge-gray';
                const badgeTxt = { 'confirmado': 'Confirmado', 'pendente': 'Pendente', 'em_andamento': 'Em andamento', 'cancelado': 'Cancelado', 'concluido': 'Concluído' }[a.status] || a.status;
                return `<div class="appt-item" onclick="showApptDetail('${a.id}')">
          <div class="appt-avatar ${cls}">${ini}</div>
          <div class="appt-info"><div class="appt-name">${a.clientName || '—'}</div><div class="appt-detail">${a.serviceName || '—'} · ${a.employeeName || '—'} · ${a.duration || '—'} min</div></div>
          <div class="appt-right"><div class="appt-time">${a.time || '—'}</div><span class="badge ${badgeCls}">${badgeTxt}</span></div>
        </div>`;
            }).join('');
        }
    }

    window.setView = function (v, btn) { agendaView = v; document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active')); btn.classList.add('active'); renderAgenda(); };
    window.prevPeriod = function () { currentPeriod = new Date(currentPeriod.getTime() - 7 * 24 * 3600 * 1000); renderAgenda(); };
    window.nextPeriod = function () { currentPeriod = new Date(currentPeriod.getTime() + 7 * 24 * 3600 * 1000); renderAgenda(); };
    window.goToday = function () { currentPeriod = new Date(); renderAgenda(); };

    function renderAgenda() {
        const wrap = document.getElementById('agendaViewWrap');
        if (agendaView === 'week') renderWeekView(wrap);
        else if (agendaView === 'day') renderDayView(wrap);
        else renderMonthView(wrap);
    }

    function getApptEvClass(status) {
        return { 'confirmado': 'ev-violet', 'pendente': 'ev-amber', 'em_andamento': 'ev-mint', 'cancelado': 'ev-rose', 'concluido': 'ev-mint' }[status] || 'ev-violet';
    }

    function renderWeekView(wrap) {
        const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        const today = new Date();
        const mon = new Date(currentPeriod);
        const dow = mon.getDay();
        mon.setDate(mon.getDate() - (dow === 0 ? 6 : dow - 1));
        const weekDays = [];
        for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(d.getDate() + i); weekDays.push(d); }
        document.getElementById('periodLabel').textContent = `${weekDays[0].getDate()} – ${weekDays[6].getDate()} ${['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][weekDays[0].getMonth()]} ${weekDays[0].getFullYear()}`;
        const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
        const H = 56;
        let html = `<div class="week-grid"><div class="week-header"><div class="wh-empty"></div>`;
        weekDays.forEach(d => {
            const isToday = d.toDateString() === today.toDateString();
            html += `<div class="wh-day${isToday ? ' today' : ''}"><div class="wh-day-name">${days[d.getDay()]}</div><div class="wh-day-num">${d.getDate()}</div></div>`;
        });
        html += `</div><div class="week-body"><div class="time-col">`;
        HOURS.forEach(h => { html += `<div class="time-slot">${h}:00</div>`; });
        html += `</div>`;
        weekDays.forEach((d, di) => {
            html += `<div class="day-col">`;
            HOURS.forEach(() => { html += `<div class="day-cell"></div>`; });
            const dayAppts = APPOINTMENTS.filter(a => {
                if (!a.date) return false;
                const ad = a.date.toDate ? a.date.toDate() : new Date(a.date);
                return ad.toDateString() === d.toDateString();
            });
            dayAppts.forEach(ev => {
                if (!ev.time) return;
                const [hh, mm] = ev.time.split(':').map(Number);
                const top = (hh - HOURS[0]) * H + (mm / 60) * H;
                const height = Math.max(((ev.duration || 30) / 60) * H - 3, 20);
                const cls = getApptEvClass(ev.status);
                html += `<div class="event-block ${cls}" style="top:${top}px;height:${height}px" onclick="showApptDetail('${ev.id}')"><div>${ev.clientName || '?'}</div><div style="font-weight:400;opacity:.75">${ev.serviceName || ''}</div></div>`;
            });
            html += `</div>`;
        });
        html += `</div></div>`;
        wrap.innerHTML = html;
    }

    function renderDayView(wrap) {
        const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
        const H = 60;
        document.getElementById('periodLabel').textContent = fmtDateShort(currentPeriod);
        let html = `<div class="daily-grid"><div class="daily-time-col">`;
        HOURS.forEach(h => { html += `<div class="daily-time-slot daily-slot">${h}:00</div>`; });
        html += `</div><div class="daily-events-col" style="position:relative">`;
        HOURS.forEach(() => { html += `<div class="daily-event-cell"></div>`; });
        const dayAppts = APPOINTMENTS.filter(a => {
            if (!a.date) return false;
            const ad = a.date.toDate ? a.date.toDate() : new Date(a.date);
            return ad.toDateString() === currentPeriod.toDateString();
        });
        dayAppts.forEach(ev => {
            if (!ev.time) return;
            const [hh, mm] = ev.time.split(':').map(Number);
            const top = (hh - HOURS[0]) * H + (mm / 60) * H;
            const height = Math.max(((ev.duration || 30) / 60) * H - 4, 28);
            const cls = getApptEvClass(ev.status);
            html += `<div class="daily-event-block ${cls}" style="top:${top}px;height:${height}px" onclick="showApptDetail('${ev.id}')"><div>${ev.clientName || '?'}</div><div style="font-weight:500;opacity:.8">${ev.serviceName || ''} · ${ev.employeeName || ''}</div></div>`;
        });
        html += `</div></div>`;
        wrap.innerHTML = html;
    }

    function renderMonthView(wrap) {
        const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        const dows = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        const y = currentPeriod.getFullYear(), m = currentPeriod.getMonth();
        document.getElementById('periodLabel').textContent = `${months[m]} ${y}`;
        const firstDay = new Date(y, m, 1).getDay();
        const totalDays = new Date(y, m + 1, 0).getDate();
        let html = `<div class="month-grid"><div class="month-header">${dows.map(d => `<div class="month-dow">${d}</div>`).join('')}</div><div class="month-body">`;
        const prevDays = new Date(y, m, 0).getDate();
        for (let i = 0; i < firstDay; i++) html += `<div class="month-day other-month"><div class="md-num">${prevDays - firstDay + i + 1}</div></div>`;
        const today = new Date();
        for (let d = 1; d <= totalDays; d++) {
            const isToday = d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
            const dayDate = new Date(y, m, d);
            const dayAppts = APPOINTMENTS.filter(a => {
                if (!a.date) return false;
                const ad = a.date.toDate ? a.date.toDate() : new Date(a.date);
                return ad.toDateString() === dayDate.toDateString();
            });
            html += `<div class="month-day${isToday ? ' today' : ''}"><div class="md-num">${d}</div><div class="md-events">`;
            dayAppts.slice(0, 2).forEach(ev => { html += `<div class="md-event ${getApptEvClass(ev.status)}">${ev.clientName || '?'}</div>`; });
            if (dayAppts.length > 2) html += `<div class="md-more">+${dayAppts.length - 2} mais</div>`;
            html += `</div></div>`;
        }
        html += `</div></div>`;
        wrap.innerHTML = html;
    }

    window.showApptDetail = function (id) {
        const a = APPOINTMENTS.find(x => x.id === id);
        if (!a) return;
        const statusOpts = ['pendente', 'confirmado', 'em_andamento', 'concluido', 'cancelado'];
        const badgeCls = s => ({ 'confirmado': 'badge-violet', 'pendente': 'badge-amber', 'em_andamento': 'badge-sky', 'cancelado': 'badge-rose', 'concluido': 'badge-mint' }[s] || 'badge-gray');
        const badgeTxt = s => ({ 'confirmado': 'Confirmado', 'pendente': 'Pendente', 'em_andamento': 'Em andamento', 'cancelado': 'Cancelado', 'concluido': 'Concluído' }[s] || s);
        const date = a.date ? (a.date.toDate ? a.date.toDate() : new Date(a.date)) : null;
        document.getElementById('apptDetailBody').innerHTML = `
      <div style="display:grid;gap:10px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div><div style="font-size:16px;font-weight:700">${a.clientName || '—'}</div><div style="font-size:13px;color:var(--text3)">${a.clientEmail || ''} · ${a.clientPhone || ''}</div></div>
          <span class="badge ${badgeCls(a.status)}">${badgeTxt(a.status)}</span>
        </div>
        <hr style="border:none;border-top:1px solid var(--border)">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
          <div><span style="color:var(--text3)">Serviço</span><div style="font-weight:600">${a.serviceName || '—'}</div></div>
          <div><span style="color:var(--text3)">Profissional</span><div style="font-weight:600">${a.employeeName || '—'}</div></div>
          <div><span style="color:var(--text3)">Data</span><div style="font-weight:600">${date ? fmtDateShort(date) : '—'}</div></div>
          <div><span style="color:var(--text3)">Horário</span><div style="font-weight:600">${a.time || '—'}</div></div>
          <div><span style="color:var(--text3)">Duração</span><div style="font-weight:600">${a.duration || '—'} min</div></div>
          <div><span style="color:var(--text3)">Valor</span><div style="font-weight:600;color:var(--violet2)">${fmtCurrency(a.price)}</div></div>
        </div>
        ${a.obs ? `<div style="background:#f8f9ff;border-radius:var(--radius);padding:10px;font-size:13px"><b>Observações:</b> ${a.obs}</div>` : ''}
        ${currentRole === 'admin' ? `
        <div class="form-group" style="margin:0">
          <label class="form-label">Alterar status</label>
          <select class="form-input" id="apptStatusSel">
            ${statusOpts.map(s => `<option value="${s}" ${a.status === s ? 'selected' : ''}>${badgeTxt(s)}</option>`).join('')}
          </select>
        </div>` : ''}
      </div>`;
        const footer = document.getElementById('apptDetailFooter');
        if (currentRole === 'admin') {
            footer.innerHTML = `
        <button class="btn btn-ghost" onclick="closeModal('apptDetailModal')">Fechar</button>
        <button class="btn btn-danger" onclick="deleteAppt('${id}')"><i class="ti ti-trash"></i> Excluir</button>
        <button class="btn btn-primary" onclick="updateApptStatus('${id}')"><i class="ti ti-check"></i> Salvar status</button>`;
        } else {
            footer.innerHTML = `
        <button class="btn btn-ghost" onclick="closeModal('apptDetailModal')">Fechar</button>
        ${a.status === 'pendente' || a.status === 'confirmado' ? `<button class="btn btn-danger" onclick="cancelAppt('${id}')"><i class="ti ti-x"></i> Cancelar</button>` : ''}`;
        }
        openModal('apptDetailModal');
    };

    window.updateApptStatus = async function (id) {
        const status = document.getElementById('apptStatusSel').value;
        try {
            await updateDoc(doc(db, 'appointments', id), { status });
            await loadAppointments();
            closeModal('apptDetailModal');
            showToast('Status atualizado!', 'success');
            if (document.getElementById('page-dashboard').classList.contains('hidden') === false) renderDashboard();
            if (document.getElementById('page-agenda').classList.contains('hidden') === false) renderAgenda();
        } catch (e) { showToast('Erro ao atualizar', 'error'); }
    };

    window.deleteAppt = async function (id) {
        if (!confirm('Excluir este agendamento?')) return;
        try {
            await deleteDoc(doc(db, 'appointments', id));
            await loadAppointments();
            closeModal('apptDetailModal');
            showToast('Agendamento excluído', 'info');
        } catch (e) { showToast('Erro ao excluir', 'error'); }
    };

    window.cancelAppt = async function (id) {
        try {
            await updateDoc(doc(db, 'appointments', id), { status: 'cancelado' });
            await loadAppointments();
            closeModal('apptDetailModal');
            showToast('Agendamento cancelado', 'info');
            renderClientPortal();
        } catch (e) { showToast('Erro ao cancelar', 'error'); }
    };

    async function initBooking() {
        await loadServices();
        await loadEmployees();
        booking = { step: 1, service: null, pro: null, date: null, time: null };
        renderSvcPicker();
        renderProfPicker();
        renderCalPicker();
        renderSlots();
        document.getElementById('confirmScreen').style.display = 'none';
        document.getElementById('confirmForm').style.display = 'block';
        document.getElementById('confirmFooter').style.display = 'flex';
        document.getElementById('clientNameInput').value = '';
        document.getElementById('clientPhoneInput').value = '';
        document.getElementById('clientEmailInput').value = '';
        document.getElementById('clientObsInput').value = '';
        // Pre-fill if client
        if (currentRole === 'client' && currentUserDoc) {
            document.getElementById('clientNameInput').value = currentUserDoc.name || '';
            document.getElementById('clientPhoneInput').value = currentUserDoc.phone || '';
            document.getElementById('clientEmailInput').value = currentUser.email || '';
        }
        nextStep(1, true);
        updateSummary();
    }

    function renderSvcPicker() {
        const g = document.getElementById('svcPickerGrid');
        const active = SERVICES.filter(s => s.active !== false);
        if (!active.length) {
            g.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="ti ti-scissors"></i></div><div class="empty-title">Nenhum serviço ativo</div><div class="empty-sub">Adicione serviços na aba Serviços</div></div>';
            return;
        }
        g.innerHTML = active.map(s => `
      <div class="svc-pick${booking.service === s.id ? ' selected' : ''}" onclick="selectService('${s.id}')">
        <div class="svc-pick-icon"><i class="ti ${s.icon || 'ti-scissors'}" style="font-size:26px;color:${booking.service === s.id ? 'var(--violet2)' : 'var(--text2)'}"></i></div>
        <div class="svc-pick-name">${s.name}</div>
        <div class="svc-pick-meta">${s.duration} min</div>
        <div class="svc-pick-price">R$ ${Number(s.price).toFixed(2).replace('.', ',')}</div>
      </div>`).join('');
    }

    window.selectService = function (id) { booking.service = id; renderSvcPicker(); updateSummary(); };

    function renderProfPicker() {
        const g = document.getElementById('profPickerGrid');
        if (!EMPLOYEES.length) {
            g.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="ti ti-users"></i></div><div class="empty-title">Nenhum profissional cadastrado</div></div>';
            return;
        }
        g.innerHTML = EMPLOYEES.map(e => {
            const cls = getAvatarClass(e.name);
            const ini = getInitials(e.name);
            return `<div class="prof-pick${booking.pro === e.id ? ' selected' : ''}" onclick="selectPro('${e.id}')">
        <div class="prof-pick-avatar ${cls}">${ini}</div>
        <div class="prof-pick-name">${e.name}</div>
        <div class="prof-pick-spec">${e.specialty || ''}</div>
      </div>`;
        }).join('');
    }

    window.selectPro = function (id) { booking.pro = id; renderProfPicker(); updateSummary(); };

    function renderCalPicker() {
        const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        document.getElementById('calPickerMonth').textContent = `${monthNames[calPickerDate.m]} ${calPickerDate.y}`;
        const grid = document.getElementById('calPickerGrid');
        const dows = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
        const firstDay = new Date(calPickerDate.y, calPickerDate.m, 1).getDay();
        const daysInMonth = new Date(calPickerDate.y, calPickerDate.m + 1, 0).getDate();
        const today = new Date();
        let html = dows.map(d => `<div class="cpg-dow">${d}</div>`).join('');
        for (let i = 0; i < firstDay; i++) html += '<div class="cpg-day"></div>';
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(calPickerDate.y, calPickerDate.m, d);
            const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const isToday = date.toDateString() === today.toDateString();
            const isSel = booking.date && booking.date.toDateString() === date.toDateString();
            html += `<div class="cpg-day"><button class="cpg-day-btn${isToday ? ' today' : ''}${isSel ? ' selected' : ''}${isPast ? ' disabled' : ''}" ${isPast ? 'disabled' : ''} onclick="selectDate(${d})">${d}</button></div>`;
        }
        grid.innerHTML = html;
    }

    window.selectDate = function (d) {
        booking.date = new Date(calPickerDate.y, calPickerDate.m, d);
        renderCalPicker();
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        document.getElementById('slotsDateLabel').textContent = `${d} ${months[calPickerDate.m]} ${calPickerDate.y}`;
        renderSlots();
        updateSummary();
    };

    window.calPickerPrev = function () { calPickerDate.m--; if (calPickerDate.m < 0) { calPickerDate.m = 11; calPickerDate.y--; } renderCalPicker(); };
    window.calPickerNext = function () { calPickerDate.m++; if (calPickerDate.m > 11) { calPickerDate.m = 0; calPickerDate.y++; } renderCalPicker(); };

    async function renderSlots() {
        const g = document.getElementById('slotsGrid');
        const times = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30'];
        let busy = [];
        if (booking.date && booking.pro) {
            const dayStr = booking.date.toDateString();
            busy = APPOINTMENTS.filter(a => {
                if (!a.date || !a.employeeId || a.status === 'cancelado') return false;
                const ad = a.date.toDate ? a.date.toDate() : new Date(a.date);
                return ad.toDateString() === dayStr && a.employeeId === booking.pro;
            }).map(a => a.time);
        }
        g.innerHTML = times.map(t => {
            const isBusy = busy.includes(t);
            const isSel = booking.time === t;
            return `<button class="time-slot-btn${isBusy ? ' busy' : ''}${isSel ? ' selected' : ''}" ${isBusy ? 'disabled' : ''} onclick="selectTime('${t}')">${t}</button>`;
        }).join('');
    }

    window.selectTime = function (t) { booking.time = t; renderSlots(); updateSummary(); };

    function updateSummary() {
        const svc = SERVICES.find(s => s.id === booking.service);
        const pro = EMPLOYEES.find(e => e.id === booking.pro);
        document.getElementById('sumService').textContent = svc ? svc.name : '—';
        document.getElementById('sumPro').textContent = pro ? pro.name : '—';
        document.getElementById('sumDate').textContent = booking.date ? fmtDateShort(booking.date) : '—';
        document.getElementById('sumTime').textContent = booking.time || '—';
        document.getElementById('sumDur').textContent = svc ? `${svc.duration} min` : '—';
        document.getElementById('sumPrice').textContent = svc ? fmtCurrency(svc.price) : '—';
    }

    window.nextStep = function (n, init = false) {
        if (!init) {
            if (n === 2 && !booking.service) { showToast('Selecione um serviço', 'error'); return; }
            if (n === 3 && !booking.pro) { showToast('Selecione um profissional', 'error'); return; }
            if (n === 4 && !booking.date) { showToast('Selecione uma data', 'error'); return; }
            if (n === 5 && !booking.time) { showToast('Selecione um horário', 'error'); return; }
        }
        booking.step = n;
        for (let i = 1; i <= 5; i++) {
            const panel = document.getElementById('bpanel' + i);
            const step = document.getElementById('bstep' + i);
            panel.classList.toggle('active', i === n);
            if (step) {
                step.classList.remove('active', 'done');
                if (i < n) step.classList.add('done');
                if (i === n) step.classList.add('active');
            }
        }
        if (n === 2) renderProfPicker();
        if (n === 4) renderSlots();
    };

    window.confirmBooking = async function () {
        const name = document.getElementById('clientNameInput').value.trim();
        const phone = document.getElementById('clientPhoneInput').value.trim();
        const email = document.getElementById('clientEmailInput').value.trim();
        const obs = document.getElementById('clientObsInput').value.trim();
        if (!name || !phone) { showToast('Preencha nome e telefone do cliente', 'error'); return; }
        const svc = SERVICES.find(s => s.id === booking.service);
        const pro = EMPLOYEES.find(e => e.id === booking.pro);
        const btn = document.getElementById('btnConfirmBooking');
        btn.disabled = true; btn.textContent = 'Salvando...';
        try {
            const apptData = {
                clientName: name, clientPhone: phone, clientEmail: email || '', obs,
                serviceId: booking.service, serviceName: svc?.name || '',
                employeeId: booking.pro, employeeName: pro?.name || '',
                date: booking.date, time: booking.time,
                duration: svc?.duration || 30, price: svc?.price || 0,
                status: 'pendente',
                createdBy: currentUser.uid,
                createdAt: serverTimestamp()
            };
            await addDoc(collection(db, 'appointments'), apptData);
            await addDoc(collection(db, 'notifications'), {
                title: 'Novo agendamento',
                message: `${name} agendou ${svc?.name || 'serviço'} com ${pro?.name || '—'} para ${fmtDateShort(booking.date)} às ${booking.time}`,
                type: 'confirmado', read: false, createdAt: serverTimestamp()
            });
            const existingClient = CLIENTS.find(c => c.phone === phone || c.email === email);
            if (!existingClient) {
                await addDoc(collection(db, 'clients'), { name, phone, email, obs, createdAt: serverTimestamp() });
            }
            await loadAppointments();
            await loadClients();
            await loadNotifications();
            document.getElementById('confirmForm').style.display = 'none';
            document.getElementById('confirmFooter').style.display = 'none';
            document.getElementById('confirmScreen').style.display = 'block';
            updateNotifBadge();
        } catch (e) { showToast('Erro ao confirmar agendamento: ' + e.message, 'error'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i> Confirmar agendamento'; }
    };

    window.resetBooking = async function () { await initBooking(); showToast('Pronto para novo agendamento', 'info'); };

    async function renderServices() {
        await loadServices();
        const g = document.getElementById('servicesGrid');
        if (!SERVICES.length) {
            g.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon"><i class="ti ti-scissors"></i></div><div class="empty-title">Nenhum serviço cadastrado</div><div class="empty-sub">Clique em "Novo Serviço" para começar.</div></div>';
            return;
        }
        g.innerHTML = SERVICES.map(s => `
      <div class="service-card">
        <div class="sc-body">
          <div class="sc-icon-wrap" style="${!s.active ? 'background:#f1f5f9' : ''}">
            <i class="ti ${s.icon || 'ti-scissors'}" style="${!s.active ? 'color:var(--text3)' : ''}"></i>
          </div>
          <div class="sc-name">${s.name}</div>
          <div class="sc-desc">${s.description || ''}</div>
          <div class="sc-info">
            <div class="sc-price" style="${!s.active ? 'color:var(--text3)' : ''}">${fmtCurrency(s.price)}</div>
            <div class="sc-dur"><i class="ti ti-clock" style="font-size:13px"></i>${s.duration} min</div>
          </div>
        </div>
        <div class="sc-footer">
          <div class="toggle-wrap">
            <label class="toggle"><input type="checkbox" ${s.active !== false ? 'checked' : ''} onchange="toggleService('${s.id}',this.checked)"><div class="toggle-track"></div><div class="toggle-thumb"></div></label>
            ${s.active !== false ? '<span style="color:var(--mint);font-weight:600">Ativo</span>' : '<span style="color:var(--text3)">Inativo</span>'}
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-icon" onclick="editService('${s.id}')"><i class="ti ti-edit"></i></button>
            <button class="btn btn-danger btn-icon" onclick="deleteService('${s.id}')"><i class="ti ti-trash"></i></button>
          </div>
        </div>
      </div>`).join('');
    }

    window.toggleService = async function (id, active) {
        await updateDoc(doc(db, 'services', id), { active });
        await loadServices();
        renderServices();
        showToast(`Serviço ${active ? 'ativado' : 'desativado'}`, active ? 'success' : 'info');
    };

    window.editService = function (id) {
        const s = SERVICES.find(x => x.id === id);
        if (!s) return;
        document.getElementById('editServiceId').value = id;
        document.getElementById('serviceModalTitle').textContent = 'Editar Serviço';
        document.getElementById('svcNome').value = s.name || '';
        document.getElementById('svcPreco').value = s.price || '';
        document.getElementById('svcDuracao').value = s.duration || '';
        document.getElementById('svcIcone').value = s.icon || 'ti-scissors';
        document.getElementById('svcDesc').value = s.description || '';
        openModal('serviceModal');
    };

    window.saveService = async function () {
        const nome = document.getElementById('svcNome').value.trim();
        const preco = parseFloat(document.getElementById('svcPreco').value) || 0;
        const dur = parseInt(document.getElementById('svcDuracao').value) || 30;
        const icone = document.getElementById('svcIcone').value;
        const desc = document.getElementById('svcDesc').value.trim();
        if (!nome) { showToast('Digite o nome do serviço', 'error'); return; }
        const editId = document.getElementById('editServiceId').value;
        try {
            if (editId) {
                await updateDoc(doc(db, 'services', editId), { name: nome, price: preco, duration: dur, icon: icone, description: desc });
                showToast('Serviço atualizado!', 'success');
            } else {
                await addDoc(collection(db, 'services'), { name: nome, price: preco, duration: dur, icon: icone, description: desc, active: true, createdAt: serverTimestamp() });
                showToast('Serviço criado!', 'success');
            }
            closeModal('serviceModal');
            document.getElementById('editServiceId').value = '';
            document.getElementById('serviceModalTitle').textContent = 'Novo Serviço';
            await renderServices();
        } catch (e) { showToast('Erro ao salvar serviço', 'error'); }
    };

    window.deleteService = async function (id) {
        if (!confirm('Excluir este serviço?')) return;
        await deleteDoc(doc(db, 'services', id));
        await renderServices();
        showToast('Serviço excluído', 'info');
    };

    async function renderTeam() {
        await loadEmployees();
        const g = document.getElementById('teamGrid');
        if (!EMPLOYEES.length) {
            g.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon"><i class="ti ti-users"></i></div><div class="empty-title">Nenhum funcionário cadastrado</div><div class="empty-sub">Clique em "Adicionar Funcionário" para começar.</div></div>';
            return;
        }
        g.innerHTML = EMPLOYEES.map(e => {
            const cls = getAvatarClass(e.name);
            const ini = getInitials(e.name);
            const todayCount = APPOINTMENTS.filter(a => {
                if (!a.date || a.employeeId !== e.id) return false;
                const d = a.date.toDate ? a.date.toDate() : new Date(a.date);
                return d.toDateString() === new Date().toDateString();
            }).length;
            return `<div class="team-card">
        <div class="tc-header">
          <div class="tc-avatar ${cls}">${ini}</div>
          <div class="tc-name">${e.name}</div>
          <div class="tc-spec">${e.specialty || ''}</div>
          <div style="margin-top:8px"><span class="badge badge-mint">Ativo</span></div>
        </div>
        <div class="tc-body">
          <div class="tc-info-row"><i class="ti ti-clock"></i>${e.workStart || '09:00'} – ${e.workEnd || '19:00'}</div>
          <div class="tc-info-row"><i class="ti ti-calendar-check"></i>${todayCount} agendamento${todayCount !== 1 ? 's' : ''} hoje</div>
          ${e.phone ? `<div class="tc-info-row"><i class="ti ti-phone"></i>${e.phone}</div>` : ''}
          <div class="tc-tags">${(e.days || []).map(d => `<span class="chip">${d}</span>`).join('')}</div>
        </div>
        <div class="tc-footer">
          <button class="btn btn-ghost btn-icon" onclick="editEmployee('${e.id}')"><i class="ti ti-edit"></i></button>
          <button class="btn btn-danger btn-icon" onclick="deleteEmployee('${e.id}')"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
        }).join('');
    }

    window.editEmployee = function (id) {
        const e = EMPLOYEES.find(x => x.id === id);
        if (!e) return;
        document.getElementById('editEmployeeId').value = id;
        document.getElementById('employeeModalTitle').textContent = 'Editar Funcionário';
        document.getElementById('empNome').value = e.name || '';
        document.getElementById('empEspec').value = e.specialty || '';
        document.getElementById('empTel').value = e.phone || '';
        document.getElementById('empEmail').value = e.email || '';
        document.getElementById('empEntrada').value = e.workStart || '09:00';
        document.getElementById('empSaida').value = e.workEnd || '19:00';
        document.querySelectorAll('.empDia').forEach(cb => {
            cb.checked = (e.days || []).includes(cb.value);
        });
        openModal('employeeModal');
    };

    window.saveEmployee = async function () {
        const nome = document.getElementById('empNome').value.trim();
        const espec = document.getElementById('empEspec').value.trim();
        const tel = document.getElementById('empTel').value.trim();
        const email = document.getElementById('empEmail').value.trim();
        const entrada = document.getElementById('empEntrada').value;
        const saida = document.getElementById('empSaida').value;
        const days = [...document.querySelectorAll('.empDia:checked')].map(cb => cb.value);
        if (!nome) { showToast('Digite o nome do funcionário', 'error'); return; }
        const editId = document.getElementById('editEmployeeId').value;
        try {
            if (editId) {
                await updateDoc(doc(db, 'employees', editId), { name: nome, specialty: espec, phone: tel, email, workStart: entrada, workEnd: saida, days });
                showToast('Funcionário atualizado!', 'success');
            } else {
                await addDoc(collection(db, 'employees'), { name: nome, specialty: espec, phone: tel, email, workStart: entrada, workEnd: saida, days, createdAt: serverTimestamp() });
                showToast('Funcionário adicionado!', 'success');
            }
            closeModal('employeeModal');
            document.getElementById('editEmployeeId').value = '';
            document.getElementById('employeeModalTitle').textContent = 'Novo Funcionário';
            await renderTeam();
        } catch (e) { showToast('Erro ao salvar funcionário', 'error'); }
    };

    window.deleteEmployee = async function (id) {
        if (!confirm('Excluir este funcionário?')) return;
        await deleteDoc(doc(db, 'employees', id));
        await renderTeam();
        showToast('Funcionário excluído', 'info');
    };

    let clientsFilter = '';
    async function renderClients(filter = '') {
        await loadClients();
        clientsFilter = filter;
        const f = filter.toLowerCase();
        const filtered = CLIENTS.filter(c => !f || c.name?.toLowerCase().includes(f) || c.email?.toLowerCase().includes(f) || c.phone?.includes(f));
        document.getElementById('clientsCount').textContent = `${CLIENTS.length} clientes cadastrados`;
        const tbody = document.getElementById('clientsBody');
        if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text3)">${filter ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado ainda.'}</td></tr>`;
            return;
        }
        tbody.innerHTML = filtered.map(c => {
            const cls = getAvatarClass(c.name || '');
            const ini = getInitials(c.name || '?');
            const count = APPOINTMENTS.filter(a => a.clientEmail === c.email || a.clientPhone === c.phone).length;
            return `<tr>
        <td><div class="td-name"><div class="user-avatar ${cls}" style="width:32px;height:32px;font-size:11px">${ini}</div>${c.name || '—'}</div></td>
        <td>${c.phone || '—'}</td>
        <td>${c.email || '—'}</td>
        <td style="font-weight:600;color:var(--violet2)">${count}</td>
        <td>${fmtDate(c.createdAt)}</td>
        <td><button class="btn btn-danger btn-icon" onclick="deleteClient('${c.id}')"><i class="ti ti-trash"></i></button></td>
      </tr>`;
        }).join('');
    }

    window.filterClients = function (v) { renderClients(v); };

    window.saveClient = async function () {
        const nome = document.getElementById('cliNome').value.trim();
        const tel = document.getElementById('cliTel').value.trim();
        const email = document.getElementById('cliEmail').value.trim();
        const obs = document.getElementById('cliObs').value.trim();
        if (!nome || !tel) { showToast('Preencha nome e telefone', 'error'); return; }
        try {
            await addDoc(collection(db, 'clients'), { name: nome, phone: tel, email, obs, createdAt: serverTimestamp() });
            closeModal('clientModal');
            ['cliNome', 'cliTel', 'cliEmail', 'cliObs'].forEach(id => { document.getElementById(id).value = ''; });
            await renderClients();
            showToast('Cliente cadastrado!', 'success');
        } catch (e) { showToast('Erro ao salvar cliente', 'error'); }
    };

    window.deleteClient = async function (id) {
        if (!confirm('Excluir este cliente?')) return;
        await deleteDoc(doc(db, 'clients', id));
        await renderClients(clientsFilter);
        showToast('Cliente excluído', 'info');
    };

    async function renderReports() {
        await loadAppointments();
        await loadClients();
        const total = APPOINTMENTS.length;
        const revenue = APPOINTMENTS.filter(a => a.status !== 'cancelado').reduce((s, a) => s + (Number(a.price) || 0), 0);
        const cancels = APPOINTMENTS.filter(a => a.status === 'cancelado').length;
        document.getElementById('rptTotal').textContent = total;
        document.getElementById('rptRevenue').textContent = fmtCurrency(revenue);
        document.getElementById('rptClients').textContent = CLIENTS.length;
        document.getElementById('rptCancel').textContent = cancels;
        const svcMap = {};
        APPOINTMENTS.forEach(a => { if (a.serviceName) svcMap[a.serviceName] = (svcMap[a.serviceName] || 0) + 1; });
        const svcSorted = Object.entries(svcMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const maxSvc = svcSorted[0]?.[1] || 1;
        document.getElementById('rptServicesChart').innerHTML = svcSorted.length ? svcSorted.map(([n, v]) => `
      <div class="chart-bar-row"><span class="chart-bar-label">${n}</span>
      <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${Math.round(v / maxSvc * 100)}%"></div></div>
      <span class="chart-bar-val">${v}x</span></div>`).join('') : '<div style="color:var(--text3);font-size:13px">Sem dados ainda</div>';
        const proMap = {};
        APPOINTMENTS.filter(a => a.status !== 'cancelado').forEach(a => { if (a.employeeName) proMap[a.employeeName] = (proMap[a.employeeName] || 0) + (Number(a.price) || 0); });
        const proSorted = Object.entries(proMap).sort((a, b) => b[1] - a[1]);
        const maxPro = proSorted[0]?.[1] || 1;
        document.getElementById('rptProsChart').innerHTML = proSorted.length ? proSorted.map(([n, v]) => `
      <div class="chart-bar-row"><span class="chart-bar-label">${n}</span>
      <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${Math.round(v / maxPro * 100)}%"></div></div>
      <span class="chart-bar-val">${fmtCurrency(v)}</span></div>`).join('') : '<div style="color:var(--text3);font-size:13px">Sem dados ainda</div>';
    }

    function updateNotifBadge() {
        const unread = NOTIFICATIONS.filter(n => !n.read).length;
        const badge = document.getElementById('notifBadge');
        const dot = document.getElementById('notifDot');
        if (unread > 0) { badge.textContent = unread; badge.classList.remove('hidden'); dot.style.display = 'block'; }
        else { badge.classList.add('hidden'); dot.style.display = 'none'; }
    }

    function renderNotifications() {
        const list = document.getElementById('notifList');
        if (!NOTIFICATIONS.length) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="ti ti-bell-off"></i></div><div class="empty-title">Nenhuma notificação</div></div>';
            return;
        }
        const typeMap = { confirmado: { cls: 'nc-violet', icon: 'ti-calendar-check' }, cancelado: { cls: 'nc-rose', icon: 'ti-x' }, pendente: { cls: 'nc-amber', icon: 'ti-clock' } };
        list.innerHTML = NOTIFICATIONS.map(n => {
            const t = typeMap[n.type] || { cls: 'nc-violet', icon: 'ti-bell' };
            const time = n.createdAt?.toDate ? n.createdAt.toDate() : new Date();
            const diff = Math.floor((Date.now() - time.getTime()) / 60000);
            const timeStr = diff < 1 ? 'Agora' : diff < 60 ? `${diff} min atrás` : diff < 1440 ? `${Math.floor(diff / 60)}h atrás` : time.toLocaleDateString('pt-BR');
            return `<div class="notif-card${n.read ? '' : ' unread'}">
        <div class="notif-card-icon ${t.cls}"><i class="ti ${t.icon}"></i></div>
        <div class="notif-card-body">
          <div class="nc-title">${n.title || 'Notificação'}</div>
          <div class="nc-msg">${n.message || ''}</div>
          <div class="nc-time"><i class="ti ti-clock" style="font-size:12px"></i> ${timeStr}</div>
        </div>
        <div class="notif-card-actions"><button class="btn btn-ghost btn-icon" onclick="deleteNotif('${n.id}')"><i class="ti ti-x"></i></button></div>
      </div>`;
        }).join('');
    }

    window.markAllRead = async function () {
        const unread = NOTIFICATIONS.filter(n => !n.read);
        await Promise.all(unread.map(n => updateDoc(doc(db, 'notifications', n.id), { read: true })));
        await loadNotifications();
        renderNotifications();
        showToast('Todas marcadas como lidas', 'success');
    };

    window.deleteNotif = async function (id) {
        await deleteDoc(doc(db, 'notifications', id));
        await loadNotifications();
        renderNotifications();
    };

    window.switchSettingsTab = function (tab, el) {
        document.querySelectorAll('[id^="stab-"]').forEach(t => t.classList.add('hidden'));
        document.querySelectorAll('.sn-item').forEach(i => i.classList.remove('active'));
        document.getElementById('stab-' + tab).classList.remove('hidden');
        el.classList.add('active');
    };

    function renderHoursEditor() {
        const ed = document.getElementById('hoursEditor');
        if (!ed) return;
        ed.innerHTML = HOURS_CONFIG.map((h, i) => `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="width:90px;font-size:13px;font-weight:600;color:${h.open ? 'var(--text1)' : 'var(--text3)'}">${h.day}</div>
        <label class="toggle"><input type="checkbox" ${h.open ? 'checked' : ''} onchange="toggleDay(${i},this.checked)"><div class="toggle-track"></div><div class="toggle-thumb"></div></label>
        <div id="dayHours${i}" style="${h.open ? '' : 'opacity:.3;pointer-events:none'};display:flex;align-items:center;gap:8px;flex:1">
          <input type="time" class="form-input" id="hStart${i}" value="${h.start || '09:00'}" style="width:120px;padding:6px 10px">
          <span style="color:var(--text3);font-size:13px">até</span>
          <input type="time" class="form-input" id="hEnd${i}" value="${h.end || '18:00'}" style="width:120px;padding:6px 10px">
        </div>
        ${!h.open ? '<span class="badge badge-rose">Fechado</span>' : ''}
      </div>`).join('');
    }

    window.toggleDay = function (i, open) {
        HOURS_CONFIG[i].open = open;
        renderHoursEditor();
        showToast(`${HOURS_CONFIG[i].day}: ${open ? 'aberto' : 'fechado'}`, open ? 'success' : 'info');
    };

    window.saveSettings = async function () {
        HOURS_CONFIG.forEach((h, i) => {
            h.start = document.getElementById('hStart' + i)?.value || h.start;
            h.end = document.getElementById('hEnd' + i)?.value || h.end;
        });
        const data = {
            nomeEmpresa: document.getElementById('cfgNomeEmpresa').value.trim(),
            telEmpresa: document.getElementById('cfgTelEmpresa').value.trim(),
            endEmpresa: document.getElementById('cfgEndEmpresa').value.trim(),
            instagram: document.getElementById('cfgInstagram').value.trim(),
            whatsapp: document.getElementById('cfgWhatsapp').value.trim(),
            sobre: document.getElementById('cfgSobre').value.trim(),
            hours: HOURS_CONFIG,
            updatedAt: serverTimestamp()
        };
        try {
            await setDoc(doc(db, 'settings', 'main'), data, { merge: true });
            showToast('Configurações salvas!', 'success');
        } catch (e) { showToast('Erro ao salvar configurações', 'error'); }
    };

    async function renderClientPortal() {
        await loadAppointments();
        const today = new Date();
        const upcoming = APPOINTMENTS.filter(a => {
            if (!a.date) return false;
            const d = a.date.toDate ? a.date.toDate() : new Date(a.date);
            return d >= today && a.status !== 'cancelado';
        }).sort((a, b) => {
            const da = a.date.toDate ? a.date.toDate() : new Date(a.date);
            const db2 = b.date.toDate ? b.date.toDate() : new Date(b.date);
            return da - db2;
        });
        const past = APPOINTMENTS.filter(a => {
            if (!a.date) return false;
            const d = a.date.toDate ? a.date.toDate() : new Date(a.date);
            return d < today || a.status === 'cancelado' || a.status === 'concluido';
        });

        const renderApptCard = (a, isUpcoming) => {
            const d = a.date ? (a.date.toDate ? a.date.toDate() : new Date(a.date)) : null;
            const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
            const badgeCls = { 'confirmado': 'badge-violet', 'pendente': 'badge-amber', 'em_andamento': 'badge-sky', 'cancelado': 'badge-rose', 'concluido': 'badge-mint' }[a.status] || 'badge-gray';
            const badgeTxt = { 'confirmado': 'Confirmado', 'pendente': 'Pendente', 'em_andamento': 'Em andamento', 'cancelado': 'Cancelado', 'concluido': 'Concluído' }[a.status] || a.status;
            return `<div class="history-card">
        <div class="hc-date"><div class="hc-date-day">${d ? d.getDate() : '?'}</div><div class="hc-date-month">${d ? months[d.getMonth()] : '—'}</div></div>
        <div class="hc-info"><div class="hc-name">${a.serviceName || '—'}</div><div class="hc-detail">${a.employeeName || '—'} · ${a.time || '—'} · ${fmtCurrency(a.price)}</div></div>
        <div class="hc-actions">
          <span class="badge ${badgeCls}">${badgeTxt}</span>
          ${isUpcoming && (a.status === 'pendente' || a.status === 'confirmado') ? `<button class="btn btn-danger btn-icon" onclick="cancelAppt('${a.id}')"><i class="ti ti-x"></i></button>` : ''}
        </div>
      </div>`;
        };

        const upEl = document.getElementById('upcomingAppts');
        upEl.innerHTML = upcoming.length ? upcoming.map(a => renderApptCard(a, true)).join('') : '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Nenhum agendamento futuro.</div>';
        const histEl = document.getElementById('historyAppts');
        histEl.innerHTML = past.length ? past.map(a => renderApptCard(a, false)).join('') : '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Sem histórico ainda.</div>';

        const totalSpent = APPOINTMENTS.filter(a => a.status === 'concluido').reduce((s, a) => s + (Number(a.price) || 0), 0);
        document.getElementById('portalStatCount').textContent = APPOINTMENTS.length;
        document.getElementById('portalStatSpent').textContent = fmtCurrency(totalSpent);
    }

    window.savePortalProfile = async function () {
        const name = document.getElementById('portalNameInput').value.trim();
        const phone = document.getElementById('portalPhone').value.trim();
        if (!name) { showToast('Digite seu nome', 'error'); return; }
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), { name, phone });
            currentUserDoc = { ...currentUserDoc, name, phone };
            document.getElementById('portalName').textContent = name;
            document.getElementById('sidebarUserName').textContent = name;
            showToast('Dados salvos!', 'success');
        } catch (e) { showToast('Erro ao salvar', 'error'); }
    };

    window.globalSearchFn = function (v) {
        if (v.length > 1 && currentRole === 'admin') { navigate('clients'); filterClients(v); }
    };

    window.openModal = function (id) { document.getElementById(id).classList.remove('hidden'); };
    window.closeModal = function (id) { document.getElementById(id).classList.add('hidden'); };
    document.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) e.target.classList.add('hidden'); });

    window.showToast = function (msg, type = 'success') {
        const icons = { success: 'ti-circle-check', error: 'ti-alert-circle', info: 'ti-info-circle' };
        const tc = document.getElementById('toastContainer');
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<i class="ti ${icons[type]} toast-icon"></i><span class="toast-msg">${msg}</span><button class="toast-close" onclick="this.parentElement.remove()"><i class="ti ti-x"></i></button>`;
        tc.appendChild(t);
        setTimeout(() => t.remove(), 3800);
    };

}

if (typeof window.showToast === 'undefined') {
    window.showToast = function (msg, type = 'success') {
        const icons = { success: 'ti-circle-check', error: 'ti-alert-circle', info: 'ti-info-circle' };
        const tc = document.getElementById('toastContainer');
        if (!tc) return;
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<i class="ti ${icons[type]} toast-icon"></i><span class="toast-msg">${msg}</span><button class="toast-close" onclick="this.parentElement.remove()"><i class="ti ti-x"></i></button>`;
        tc.appendChild(t);
        setTimeout(() => t.remove(), 3800);
    };
}
