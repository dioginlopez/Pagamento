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
    res.json({ month, members: consultarDadosFinanceiros(month) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
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

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "..", "frontend", "login.html")));

async function start() {
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  database = fs.existsSync(databasePath) ? new SQL.Database(fs.readFileSync(databasePath)) : new SQL.Database();
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, display_name TEXT NOT NULL, document TEXT NOT NULL UNIQUE, phone TEXT NOT NULL, category TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, month TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, paid_at TEXT, UNIQUE(member_id, month), FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS bar_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, month TEXT NOT NULL, amount_cents INTEGER NOT NULL DEFAULT 0, UNIQUE(member_id, month), FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE);
  `);
  if (!buscarUm("SELECT id FROM users LIMIT 1")) {
    const username = process.env.ADMIN_USER || "admin";
    const password = process.env.ADMIN_PASSWORD || "admin123";
    executar("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, bcrypt.hashSync(password, 12)]);
    console.log(`Usuario inicial criado: ${username}. Altere a senha antes de usar em producao.`);
  } else persist();
  app.listen(port, host, () => console.log(`CSSPP rodando em http://${host}:${port}`));
}

start().catch((error) => { console.error(error); process.exit(1); });
