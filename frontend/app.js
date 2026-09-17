const token = localStorage.getItem("csspp-token");
let month = new Date().toISOString().slice(0, 7);
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const typeNames = { militar: "Militar", civil: "Civil", diretoria: "Diretoria", "ex-presidente": "Ex-presidente", funcionario: "Funcionário do clube" };
const state = { members: [], users: [], pixKey: "" };

if (!token) window.location.replace("login.html");

async function api(url, options = {}) {
    let response;
    try {
        response = await fetch(url, {
            ...options,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) }
        });
    } catch {
        throw new Error("Não foi possível conectar ao servidor. Abra o sistema por http://localhost:3000 e mantenha o backend ligado.");
    }
    if (response.status === 401) {
        localStorage.removeItem("csspp-token");
        window.location.replace("login.html");
        throw new Error("Sessão expirada.");
    }
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(data?.error || "Não foi possível concluir a operação.");
    return data;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[character]));
}

function displayName(member) {
    return member.displayName || member.fullName;
}

function whatsappNumber(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    return digits.length >= 12 ? digits : `55${digits}`;
}

function whatsappLink(member) {
    if (!member.phone || member.paid || member.total === 0) return "";
    const pix = state.pixKey ? ` Chave PIX: ${state.pixKey}.` : "";
    const message = `🔔 *CSSPP - Lembrete de cobrança*\n\nOlá, ${displayName(member)}!\n\nIdentificamos uma pendência de *${currency.format(member.total)}* referente a *${month}*.\nMensalidade: ${currency.format(member.fee)}\nBar: ${currency.format(member.bar)}\n\n${pix}\nApós o pagamento, envie o comprovante. Obrigado!`;
    return `<a class="whatsapp-link" href="https://wa.me/${whatsappNumber(member.phone)}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">WhatsApp</a>`;
}

function renderUsers() {
    document.getElementById("listaUsuarios").innerHTML = state.users.length ? `<div class="lista-usuarios">${state.users.map((user) => `<div class="usuario-item"><span class="usuario-inicial">${escapeHtml(user.username.charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(user.username)}</strong><small>${escapeHtml(user.role === "admin" ? "Administrador" : "Usuário" )}</small></div></div>`).join("")}</div>` : '<p class="lista-vazia">Nenhum usuário encontrado.</p>';
}

function toast(message) {
    const element = document.getElementById("toast");
    element.textContent = message;
    element.classList.add("visible");
    window.setTimeout(() => element.classList.remove("visible"), 2600);
}

function updateSummary() {
    const pendingTotal = state.members.filter((member) => !member.paid).reduce((sum, member) => sum + member.total, 0);
    const barTotal = state.members.reduce((sum, member) => sum + member.bar, 0);
    const paid = state.members.filter((member) => member.paid).length;
    const percentage = state.members.length ? Math.round((paid / state.members.length) * 100) : 0;
    document.getElementById("totalReceber").textContent = currency.format(pendingTotal);
    document.getElementById("totalPagos").textContent = paid;
    document.getElementById("percentualPagos").textContent = `${percentage}% dos sócios pagos`;
    document.getElementById("totalSocios").textContent = state.members.length;
    document.getElementById("totalBar").textContent = currency.format(barTotal);
}

function renderBarSelect() {
    const select = document.getElementById("socioBar");
    const current = select.value;
    select.innerHTML = '<option value="">Selecione um sócio</option>' + state.members.map((member) => `<option value="${member.id}">${escapeHtml(displayName(member))}</option>`).join("");
    select.value = current;
    document.getElementById("valorBarMes").value = select.value ? state.members.find((member) => String(member.id) === select.value)?.bar || "" : "";
}

function renderMembers() {
    const list = document.getElementById("listaSocios");
    const search = document.getElementById("buscaSocio").value.toLowerCase().trim();
    const filter = document.getElementById("filtroPagamento").value;
    const members = state.members.filter((member) => {
        const matchesSearch = [displayName(member), member.fullName, member.document].some((value) => value.toLowerCase().includes(search));
        const matchesFilter = filter === "todos" || (filter === "pagos" && member.paid) || (filter === "pendentes" && !member.paid);
        return matchesSearch && matchesFilter;
    });
    if (!members.length) {
        list.innerHTML = '<tr class="empty-row"><td colspan="7">Nenhum sócio encontrado.</td></tr>';
        return;
    }
    list.innerHTML = members.map((member) => {
        const name = displayName(member);
        const noCharge = member.total === 0;
        const status = noCharge ? "Sem cobrança" : member.paid ? "Pago" : "Confirmar pagamento";
        const statusAction = noCharge ? "" : `data-action="toggle-payment" data-id="${member.id}"`;
        return `<tr>
            <td><div class="member-cell"><span class="member-avatar">${escapeHtml(name.charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(member.fullName)} · ${escapeHtml(member.document)}</small></div></div></td>
            <td><span class="category ${escapeHtml(member.category)}">${escapeHtml(typeNames[member.category])}</span></td>
            <td>${currency.format(member.fee)}</td><td>${currency.format(member.bar)}</td><td><strong>${currency.format(member.total)}</strong></td>
            <td><button class="status-button ${noCharge ? "exempt" : member.paid ? "paid" : "pending"}" ${statusAction}>${status}</button></td>
            <td><div class="action-cell">${whatsappLink(member)}<button class="delete-button" type="button" title="Excluir sócio" data-action="delete-member" data-id="${member.id}">×</button></div></td>
        </tr>`;
    }).join("");
}

function render() {
    updateSummary();
    renderBarSelect();
    renderMembers();
}

async function load() {
    try {
        const data = await api(`/api/dashboard?month=${month}`);
        state.members = data.members;
        state.pixKey = data.pixKey || "";
        const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        document.getElementById("periodoAtual").textContent = `Acompanhe as cobranças e os totais do bar de ${monthLabel}.`;
        document.getElementById("mesBadge").textContent = monthLabel;
        document.getElementById("mesBarLabel").textContent = monthLabel;
        render();
    } catch (error) {
        toast(error.message);
    }
}

document.getElementById("mesSelecionado").value = month;
document.getElementById("mesSelecionado").addEventListener("change", async (event) => {
    if (!event.target.value) return;
    month = event.target.value;
    await load();
});

async function loadCurrentUser() {
    const data = await api("/api/auth/me");
    document.getElementById("usuarioAtual").textContent = data.user.username;
    document.getElementById("botaoSair").title = `Sair da conta de ${data.user.username}`;
    document.getElementById("botaoSair").textContent = data.user.username.slice(0, 2).toUpperCase();
    if (data.user.role === "admin") {
        document.getElementById("usuarios").hidden = false;
        const users = await api("/api/users");
        state.users = users.users;
        renderUsers();
    }
}

document.getElementById("formSocio").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        await api("/api/members", { method: "POST", body: JSON.stringify({
            fullName: document.getElementById("nomeCompleto").value,
            displayName: document.getElementById("nomeExibicao").value,
            document: document.getElementById("documentoSocio").value,
            phone: document.getElementById("telefoneSocio").value,
            category: document.getElementById("tipoSocio").value
        }) });
        event.target.reset();
        await load();
        toast("Sócio cadastrado no banco de dados.");
    } catch (error) {
        toast(error.message);
    }
});

document.getElementById("formBar").addEventListener("submit", async (event) => {
    event.preventDefault();
    const memberId = document.getElementById("socioBar").value;
    try {
        await api(`/api/members/${memberId}/bar`, { method: "PUT", body: JSON.stringify({ month, amount: Number(document.getElementById("valorBarMes").value) }) });
        await load();
        toast("Total do bar salvo no banco.");
    } catch (error) {
        toast(error.message);
    }
});

document.getElementById("socioBar").addEventListener("change", renderBarSelect);
document.getElementById("buscaSocio").addEventListener("input", renderMembers);
document.getElementById("filtroPagamento").addEventListener("change", renderMembers);

document.getElementById("botaoSair").addEventListener("click", () => {
    localStorage.removeItem("csspp-token");
    window.location.replace("login.html");
});

document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const memberId = target.dataset.id;
    try {
        if (target.dataset.action === "toggle-payment") {
            const member = state.members.find((item) => String(item.id) === memberId);
            await api(`/api/members/${memberId}/payment`, { method: "PATCH", body: JSON.stringify({ month, paid: !member.paid }) });
            await load();
            toast(member.paid ? "Pagamento voltou para pendente." : "Pagamento confirmado.");
        }
        if (target.dataset.action === "delete-member" && window.confirm("Excluir este sócio e seus lançamentos?")) {
            await api(`/api/members/${memberId}`, { method: "DELETE" });
            await load();
            toast("Sócio excluído.");
        }
    } catch (error) {
        toast(error.message);
    }
});

document.getElementById("exportarPlanilha").addEventListener("click", () => {
    const header = ["Nome completo", "Nome para exibicao", "CPF ou matricula", "WhatsApp", "Categoria", "Mensalidade", "Bar no mes", "Total a cobrar", "Situacao"];
    const rows = state.members.map((member) => [member.fullName, displayName(member), member.document, member.phone, typeNames[member.category], member.fee.toFixed(2).replace(".", ","), member.bar.toFixed(2).replace(".", ","), member.total.toFixed(2).replace(".", ","), member.total === 0 ? "Sem cobranca" : member.paid ? "Pago" : "Pendente"]);
    const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(quote).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `socios-${month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast("Planilha exportada.");
});

document.getElementById("formUsuario").addEventListener("submit", async (event) => {
    event.preventDefault();
    const feedback = document.getElementById("feedbackUsuario");
    feedback.textContent = "";
    try {
        await api("/api/users", {
            method: "POST",
            body: JSON.stringify({
                username: document.getElementById("novoUsuario").value,
                password: document.getElementById("novaSenha").value
            })
        });
        event.target.reset();
        const users = await api("/api/users");
        state.users = users.users;
        renderUsers();
        feedback.textContent = "Usuário cadastrado com sucesso.";
        toast("Novo usuário criado.");
    } catch (error) {
        feedback.textContent = error.message;
        feedback.style.color = "#b00000";
    }
});

Promise.all([load(), loadCurrentUser()]).catch((error) => toast(error.message));
