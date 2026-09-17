const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const initSqlJs = require("sql.js");

// Configurações centrais da aplicação e do banco local.
const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const jwtSecret = process.env.JWT_SECRET || "csspp-desenvolvimento-troque-esta-chave";
const pastaBanco = process.env.DATABASE_DIR || path.join(__dirname, "..", "database");
const databasePath = path.join(pastaBanco, "csspp.sqlite");
const whatsappToken = process.env.WHATSAPP_TOKEN || "";
const whatsappNumeroId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const whatsappModelo = process.env.WHATSAPP_TEMPLATE_NAME || "cobranca_mensalidade";
const whatsappIdioma = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "pt_BR";
const whatsappFigurinhaUrl = process.env.WHATSAPP_STICKER_URL || "";
const chavePix = process.env.PIX_KEY || "";
const segredoWebhookPix = process.env.PIX_WEBHOOK_SECRET || "";
const horaCobranca = Number(process.env.COBRANCA_HORA || 8);
const categorias = new Set(["civil", "militar", "diretoria", "ex-presidente", "funcionario"]);
const mensalidades = { civil: 50, militar: 30, diretoria: 0, "ex-presidente": 0, funcionario: 0 };
let database;

// Garante que uma instalação nova tenha a pasta do banco antes da primeira gravação.
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Persiste o banco em arquivo depois de cada operação de escrita.
function persist() {
  fs.writeFileSync(databasePath, Buffer.from(database.export()));
}

function prepararConsulta(sql, params = []) {
  const query = database.prepare(sql);
  query.bind(params);
  return query;
}

function buscarUm(sql, params = []) {
  const query = prepararConsulta(sql, params);
  const result = query.step() ? query.getAsObject() : undefined;
  query.free();
  return result;
}

function buscarTodos(sql, params = []) {
  const query = prepararConsulta(sql, params);
  const rows = [];
  while (query.step()) rows.push(query.getAsObject());
  query.free();
  return rows;
}

function executar(sql, params = []) {
  const query = prepararConsulta(sql, params);
  query.step();
  query.free();
  const result = { changes: database.getRowsModified(), lastInsertRowid: buscarUm("SELECT last_insert_rowid() AS id").id };
  persist();
  return result;
}

function obterMes(value) {
  const month = value || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mes invalido. Use o formato AAAA-MM.");
  return month;
}

function validarTexto(value, field, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${field} e obrigatorio.`);
  return value.trim();
}

function validarSocio(body) {
  const fullName = validarTexto(body.fullName, "Nome completo");
  const displayName = validarTexto(body.displayName, "Nome para exibicao");
  const document = validarTexto(body.document, "CPF ou matricula", 40);
  const phone = validarTexto(body.phone, "WhatsApp", 30);
  const category = validarTexto(body.category, "Categoria", 30);
  if (!categorias.has(category)) throw new Error("Categoria invalida.");
  return { fullName, displayName, document, phone, category };
}

function numeroWhatsApp(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  return digitos.length >= 12 ? digitos : `55${digitos}`;
}

// O vencimento acontece no dia 1; sábado e domingo passam para a segunda-feira.
function ehPrimeiroDiaUtil(data) {
  const dia = data.getDate();
  const semana = data.getDay();
  if (dia === 1 && semana !== 0 && semana !== 6) return true;
  if (dia === 2 && semana === 1) {
    const primeiro = new Date(data.getFullYear(), data.getMonth(), 1);
    return primeiro.getDay() === 0;
  }
  if (dia === 3 && semana === 1) {
    const primeiro = new Date(data.getFullYear(), data.getMonth(), 1);
    return primeiro.getDay() === 6;
  }
  return false;
}

function dataLocal() {
  const agora = new Date();
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TZ || "America/Campo_Grande", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(agora);
  const valor = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return new Date(Number(valor.year), Number(valor.month) - 1, Number(valor.day), Number(valor.hour));
}

function configurarCobranca() {
  return Boolean(whatsappToken && whatsappNumeroId && whatsappModelo);
}

async function enviarWhatsApp(socio, mes, total) {
  const resposta = await fetch(`https://graph.facebook.com/v22.0/${whatsappNumeroId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${whatsappToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: numeroWhatsApp(socio.phone), type: "template", template: { name: whatsappModelo, language: { code: whatsappIdioma }, components: [{ type: "body", parameters: [{ type: "text", text: socio.displayName }, { type: "text", text: `R$ ${total.toFixed(2).replace(".", ",")}` }, { type: "text", text: mes }] }] } })
  });
  if (!resposta.ok) throw new Error(`WhatsApp retornou HTTP ${resposta.status}.`);
  if (whatsappFigurinhaUrl) {
    const imagem = await fetch(`https://graph.facebook.com/v22.0/${whatsappNumeroId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${whatsappToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: numeroWhatsApp(socio.phone), type: "image", image: { link: whatsappFigurinhaUrl, caption: "CSSPP - Obrigado por participar do clube!" } })
    });
    if (!imagem.ok) throw new Error(`Figurinha do WhatsApp retornou HTTP ${imagem.status}.`);
  }
}

// Envia uma única cobrança por competência e evita reenvios duplicados.
async function processarCobrancasMensais() {
  const agora = dataLocal();
  if (!ehPrimeiroDiaUtil(agora) || agora.getHours() < horaCobranca) return;
  if (!configurarCobranca()) return console.log("Cobranca automatica ignorada: configure as variaveis WHATSAPP_*.");
  const mes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
  const socios = consultarDadosFinanceiros(mes).filter((socio) => !socio.paid && socio.total > 0 && socio.phone && !buscarUm("SELECT id FROM notificacoes WHERE member_id = ? AND month = ?", [socio.id, mes]));
  for (const socio of socios) {
    try {
      await enviarWhatsApp(socio, mes, socio.total);
      executar("INSERT INTO notificacoes (member_id, month, sent_at, status) VALUES (?, ?, ?, ?)", [socio.id, mes, new Date().toISOString(), "enviado"]);
      console.log(`Cobranca enviada para ${socio.displayName} (${mes}).`);
    } catch (error) {
      console.error(`Falha na cobranca de ${socio.displayName}: ${error.message}`);
    }
  }
}

// Exige um token válido nas rotas protegidas.
function autenticar(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: "Sessao expirada. Entre novamente." });
  }
}

function consultarDadosFinanceiros(month) {
  return buscarTodos(`
    SELECT m.id, m.full_name AS fullName, m.display_name AS displayName, m.document, m.phone, m.category,
      COALESCE(p.paid, 0) AS paid, COALESCE(b.amount_cents, 0) AS barCents
    FROM members m
    LEFT JOIN payments p ON p.member_id = m.id AND p.month = ?
    LEFT JOIN bar_entries b ON b.member_id = m.id AND b.month = ?
    ORDER BY m.display_name COLLATE NOCASE
  `, [month, month]).map((member) => ({
    ...member,
    paid: Boolean(Number(member.paid)),
    fee: mensalidades[member.category],
    bar: Number(member.barCents) / 100,
    total: mensalidades[member.category] + Number(member.barCents) / 100
  }));
}

app.post("/api/auth/login", (req, res) => {
  try {
    const username = validarTexto(req.body.username, "Usuario", 60);
    const password = validarTexto(req.body.password, "Senha", 200);
    const user = buscarUm("SELECT * FROM users WHERE username = ?", [username]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: "Usuario ou senha invalidos." });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, jwtSecret, { expiresIn: "8h" });
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/auth/me", autenticar, (req, res) => {
  res.json({ user: { username: req.user.username, role: req.user.role } });
});

app.get("/api/dashboard", autenticar, (req, res) => {
  try {
    const month = obterMes(req.query.month);
    res.json({ month, members: consultarDadosFinanceiros(month), pixKey: chavePix });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/users", autenticar, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Apenas administradores podem consultar usuarios." });
  res.json({ users: buscarTodos("SELECT username, role, created_at AS createdAt FROM users ORDER BY username COLLATE NOCASE") });
});

app.post("/api/members", autenticar, (req, res) => {
  try {
    const member = validarSocio(req.body);
    const result = executar("INSERT INTO members (full_name, display_name, document, phone, category) VALUES (?, ?, ?, ?, ?)", [member.fullName, member.displayName, member.document, member.phone, member.category]);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    res.status(400).json({ error: error.message.includes("UNIQUE") ? "CPF ou matricula ja cadastrado." : error.message });
  }
});

app.put("/api/members/:id", autenticar, (req, res) => {
  try {
    const member = validarSocio(req.body);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new Error("Socio invalido.");
    const result = executar("UPDATE members SET full_name = ?, display_name = ?, document = ?, phone = ?, category = ? WHERE id = ?", [member.fullName, member.displayName, member.document, member.phone, member.category, id]);
    if (!result.changes) return res.status(404).json({ error: "Socio nao encontrado." });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message.includes("UNIQUE") ? "CPF ou matricula ja cadastrado." : error.message });
  }
});

app.patch("/api/members/:id/payment", autenticar, (req, res) => {
  try {
    const memberId = Number(req.params.id);
    const month = obterMes(req.body.month);
    if (!Number.isInteger(memberId) || typeof req.body.paid !== "boolean") throw new Error("Pagamento invalido.");
    executar(`INSERT INTO payments (member_id, month, paid, paid_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(member_id, month) DO UPDATE SET paid = excluded.paid, paid_at = excluded.paid_at`, [memberId, month, req.body.paid ? 1 : 0, req.body.paid ? new Date().toISOString() : null]);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/members/:id/bar", autenticar, (req, res) => {
  try {
    const memberId = Number(req.params.id);
    const month = obterMes(req.body.month);
    const amount = Number(req.body.amount);
    if (!Number.isInteger(memberId) || !Number.isFinite(amount) || amount < 0 || amount > 1000000) throw new Error("Valor do bar invalido.");
    executar(`INSERT INTO bar_entries (member_id, month, amount_cents) VALUES (?, ?, ?)
      ON CONFLICT(member_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`, [memberId, month, Math.round(amount * 100)]);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/members/:id", autenticar, (req, res) => {
  const result = executar("DELETE FROM members WHERE id = ?", [Number(req.params.id)]);
  if (!result.changes) return res.status(404).json({ error: "Socio nao encontrado." });
  res.status(204).end();
});

app.post("/api/users", autenticar, (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Apenas administradores podem criar usuarios." });
    const username = validarTexto(req.body.username, "Usuario", 60);
    const password = validarTexto(req.body.password, "Senha", 200);
    if (password.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres.");
    const result = executar("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, bcrypt.hashSync(password, 12)]);
    res.status(201).json({ id: result.lastInsertRowid, username });
  } catch (error) {
    res.status(400).json({ error: error.message.includes("UNIQUE") ? "Usuario ja cadastrado." : error.message });
  }
});

// Recebe a confirmação do provedor PIX e só baixa a cobrança com valor compatível.
app.post("/api/webhooks/pix", (req, res) => {
  try {
    if (!segredoWebhookPix || req.headers["x-webhook-secret"] !== segredoWebhookPix) return res.status(401).json({ error: "Webhook nao autorizado." });
    const { status, document, month, amount } = req.body;
    if (status !== "CONFIRMED" || typeof document !== "string" || typeof month !== "string" || !Number.isFinite(Number(amount))) throw new Error("Confirmacao PIX invalida.");
    const socio = buscarUm("SELECT id FROM members WHERE document = ?", [document.trim()]);
    if (!socio) return res.status(404).json({ error: "Socio nao encontrado." });
    const cobranca = consultarDadosFinanceiros(obterMes(month)).find((item) => Number(item.id) === Number(socio.id));
    if (!cobranca || Math.round(Number(amount) * 100) !== Math.round(cobranca.total * 100)) return res.status(409).json({ error: "Valor do PIX nao corresponde ao total da cobranca." });
    executar(`INSERT INTO payments (member_id, month, paid, paid_at) VALUES (?, ?, 1, ?)
      ON CONFLICT(member_id, month) DO UPDATE SET paid = 1, paid_at = excluded.paid_at`, [socio.id, obterMes(month), new Date().toISOString()]);
    res.json({ ok: true, paid: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "..", "frontend", "login.html")));

async function start() {
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  database = fs.existsSync(databasePath) ? new SQL.Database(fs.readFileSync(databasePath)) : new SQL.Database();
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, display_name TEXT NOT NULL, document TEXT NOT NULL UNIQUE, phone TEXT NOT NULL, category TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, month TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, paid_at TEXT, UNIQUE(member_id, month), FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS bar_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, month TEXT NOT NULL, amount_cents INTEGER NOT NULL DEFAULT 0, UNIQUE(member_id, month), FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS notificacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, month TEXT NOT NULL, sent_at TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(member_id, month), FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE);
  `);
  if (!buscarUm("SELECT id FROM users LIMIT 1")) {
    const username = process.env.ADMIN_USER || "admin";
    const password = process.env.ADMIN_PASSWORD || "admin123";
    executar("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, bcrypt.hashSync(password, 12)]);
    console.log(`Usuario inicial criado: ${username}. Altere a senha antes de usar em producao.`);
  } else persist();
  app.listen(port, host, () => {
    console.log(`CSSPP rodando em http://${host}:${port}`);
    setInterval(() => processarCobrancasMensais().catch((error) => console.error("Erro no agendador de cobrancas:", error.message)), 60 * 1000);
    processarCobrancasMensais().catch((error) => console.error("Erro inicial no agendador de cobrancas:", error.message));
  });
}

start().catch((error) => { console.error(error); process.exit(1); });
