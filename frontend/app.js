const token = sessionStorage.getItem("csspp-token");
let month = new Date().toISOString().slice(0, 7);
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const typeNames = { militar: "Militar", civil: "Civil", diretoria: "Diretoria", "ex-presidente": "Ex-presidente", funcionario: "Funcionário do clube" };
const state = { members: [], users: [], pixKey: "", currentUser: "" };

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
        sessionStorage.removeItem("csspp-token");
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
    const pix = state.pixKey ? `💳 *PAGUE VIA PIX*\nChave PIX: *${state.pixKey}*` : "💳 Chave PIX ainda não configurada pelo clube.";
    const message = `🔔 *CSSPP - Lembrete de cobrança*\n\nOlá, ${displayName(member)}!\n\nIdentificamos uma pendência de *${currency.format(member.total)}* referente a *${month}*.\nMensalidade: ${currency.format(member.fee)}\nBar: ${currency.format(member.bar)}\n\n${pix}\n\nApós o pagamento, envie o comprovante. Obrigado!`;
    return `<a class="whatsapp-link" href="https://wa.me/${whatsappNumber(member.phone)}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">WhatsApp</a>`;
}

function renderUsers() {
    document.getElementById("listaUsuarios").innerHTML = state.users.length ? `<div class="lista-usuarios">${state.users.map((user) => `<div class="usuario-item"><span class="usuario-inicial">${escapeHtml(user.username.charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(user.username)}</strong><small>${escapeHtml(user.role === "admin" ? "Administrador" : "Usuário" )}</small></div>${user.username === state.currentUser ? '<span class="usuario-atual-tag">Você</span>' : `<button class="delete-button" type="button" title="Excluir usuário" data-action="delete-user" data-id="${user.id}">×</button>`}</div>`).join("")}</div>` : '<p class="lista-vazia">Nenhum usuário encontrado.</p>';
}

function toast(message) {
    const element = document.getElementById("toast");
    element.textContent = message;
    element.classList.add("visible");
    window.setTimeout(() => element.classList.remove("visible"), 2600);
}

function applyScreen() {
    const screen = window.location.hash.slice(1) || "inicio";
    const validScreens = ["inicio", "socios", "bar", "editarSocios", "usuarios"];
    const activeScreen = validScreens.includes(screen) ? screen : "inicio";
    document.querySelectorAll(".screen-view").forEach((view) => {
        view.classList.toggle("screen-active", view.dataset.screen === activeScreen);
    });
    const workspace = document.querySelector(".workspace-grid");
    workspace.classList.toggle("screen-empty", !["socios", "bar"].includes(activeScreen));
    document.querySelectorAll(".nav-link").forEach((link) => {
        link.classList.toggle("active", link.getAttribute("href") === `#${activeScreen}`);
    });
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

function renderEditSelect() {
    const select = document.getElementById("socioEditar");
    const current = select.value;
    select.innerHTML = '<option value="">Selecione um sócio</option>' + state.members.map((member) => `<option value="${member.id}">${escapeHtml(displayName(member))}</option>`).join("");
    select.value = current;
}

function preencherEdicao() {
    const member = state.members.find((item) => String(item.id) === document.getElementById("socioEditar").value);
    if (!member) return;
    document.getElementById("editarNomeCompleto").value = member.fullName;
    document.getElementById("editarNomeExibicao").value = member.displayName;
    document.getElementById("editarDocumento").value = member.document;
    document.getElementById("editarTelefone").value = member.phone;
    document.getElementById("editarCategoria").value = member.category;
}

function renderMembers() {
    const list = document.getElementById("listaSocios");
    const resultCounter = document.getElementById("resultadoSocios");
    const search = document.getElementById("buscaSocio").value.toLowerCase().trim();
    const paymentFilter = document.getElementById("filtroPagamento").value;
    const categoryFilter = document.getElementById("filtroCategoria").value;
    const orderBy = document.getElementById("ordemSocios").value;

    const members = [...state.members].filter((member) => {
        const matchesSearch = [displayName(member), member.fullName, member.document].some((value) => value.toLowerCase().includes(search));
        const matchesPayment = paymentFilter === "todos" || (paymentFilter === "pagos" && member.paid) || (paymentFilter === "pendentes" && !member.paid);
        const matchesCategory = categoryFilter === "todos" || member.category === categoryFilter;
        return matchesSearch && matchesPayment && matchesCategory;
    }).sort((a, b) => {
        if (orderBy === "pendentes") return Number(a.paid) - Number(b.paid) || displayName(a).localeCompare(displayName(b), "pt-BR");
        if (orderBy === "valor") return b.total - a.total || displayName(a).localeCompare(displayName(b), "pt-BR");
        if (orderBy === "categoria") return typeNames[a.category].localeCompare(typeNames[b.category], "pt-BR") || displayName(a).localeCompare(displayName(b), "pt-BR");
        return displayName(a).localeCompare(displayName(b), "pt-BR");
    });

    resultCounter.textContent = `${members.length} sócio${members.length === 1 ? "" : "s"} encontrado${members.length === 1 ? "" : "s"}`;

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
            <td><div class="action-cell">${whatsappLink(member)}<button class="edit-button" type="button" title="Editar sócio" data-action="edit-member" data-id="${member.id}">Editar</button><button class="delete-button" type="button" title="Excluir sócio" data-action="delete-member" data-id="${member.id}">×</button></div></td>
        </tr>`;
    }).join("");
}

function render() {
    updateSummary();
    renderBarSelect();
    renderEditSelect();
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

window.addEventListener("hashchange", applyScreen);
applyScreen();

async function loadCurrentUser() {
    const data = await api("/api/auth/me");
    state.currentUser = data.user.username;
    document.getElementById("usuarioAtual").textContent = data.user.username;
    document.getElementById("botaoSair").title = `Sair da conta de ${data.user.username}`;
    document.getElementById("botaoSair").textContent = data.user.username.slice(0, 2).toUpperCase();
    if (data.user.role === "admin") {
        document.getElementById("usuarios").hidden = false;
        document.getElementById("navUsuarios").hidden = false;
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
document.getElementById("filtroCategoria").addEventListener("change", renderMembers);
document.getElementById("ordemSocios").addEventListener("change", renderMembers);
document.getElementById("limparBusca").addEventListener("click", () => {
    document.getElementById("buscaSocio").value = "";
    renderMembers();
});
document.getElementById("resetarFiltros").addEventListener("click", () => {
    document.getElementById("buscaSocio").value = "";
    document.getElementById("filtroPagamento").value = "todos";
    document.getElementById("filtroCategoria").value = "todos";
    document.getElementById("ordemSocios").value = "nome";
    renderMembers();
});

document.getElementById("socioEditar").addEventListener("change", preencherEdicao);

document.getElementById("formEditarSocio").addEventListener("submit", async (event) => {
    event.preventDefault();
    const memberId = document.getElementById("socioEditar").value;
    const feedback = document.getElementById("feedbackEdicao");
    feedback.style.color = "#168657";
    try {
        if (!memberId) {
            feedback.textContent = "Selecione um sócio antes de salvar.";
            feedback.style.color = "#b00000";
            return;
        }
        await api(`/api/members/${memberId}`, { method: "PUT", body: JSON.stringify({
            fullName: document.getElementById("editarNomeCompleto").value,
            displayName: document.getElementById("editarNomeExibicao").value,
            document: document.getElementById("editarDocumento").value,
            phone: document.getElementById("editarTelefone").value,
            category: document.getElementById("editarCategoria").value
        }) });
        await load();
        preencherEdicao();
        feedback.textContent = "Dados do sócio atualizados.";
        toast("Cadastro atualizado com sucesso.");
    } catch (error) {
        feedback.textContent = error.message;
        feedback.style.color = "#b00000";
    }
});

document.getElementById("botaoSair").addEventListener("click", () => {
    sessionStorage.removeItem("csspp-token");
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
        if (target.dataset.action === "edit-member") {
            const select = document.getElementById("socioEditar");
            const member = state.members.find((item) => String(item.id) === memberId);
            if (!member) return;
            select.value = String(member.id);
            preencherEdicao();
            document.getElementById("editarSocios").scrollIntoView({ behavior: "smooth", block: "start" });
            toast("Editando sócio selecionado.");
        }
        if (target.dataset.action === "delete-member" && window.confirm("Excluir este sócio e seus lançamentos?")) {
            await api(`/api/members/${memberId}`, { method: "DELETE" });
            await load();
            toast("Sócio excluído.");
        }
        if (target.dataset.action === "delete-user" && window.confirm("Excluir este usuário?")) {
            await api(`/api/users/${target.dataset.id}`, { method: "DELETE" });
            const users = await api("/api/users");
            state.users = users.users;
            renderUsers();
            toast("Usuário excluído.");
        }
    } catch (error) {
        toast(error.message);
    }
});

document.getElementById("exportarPlanilha").addEventListener("click", () => {
    if (!state.members.length) {
        toast("Nenhum sócio para exportar.");
        return;
    }
    const linhas = [...state.members].sort((a, b) => displayName(a).localeCompare(displayName(b), "pt-BR")).map((member) => {
        const status = member.total === 0 ? "Sem cobrança" : member.paid ? "Pago" : "Pendente";
        return [
            displayName(member),
            member.fullName,
            member.document,
            member.phone || "",
            typeNames[member.category],
            member.fee.toFixed(2).replace(".", ","),
            member.bar.toFixed(2).replace(".", ","),
            member.total.toFixed(2).replace(".", ","),
            status
        ];
    });
    const cabecalho = ["Nome de exibição", "Nome completo", "CPF/Matrícula", "WhatsApp", "Categoria", "Mensalidade", "Bar no mês", "Total a cobrar", "Situação"];
    const csv = [cabecalho, ...linhas].map((linha) => linha.map((valor) => `"${String(valor).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-socios-${month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast("Planilha exportada em CSV.");
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
