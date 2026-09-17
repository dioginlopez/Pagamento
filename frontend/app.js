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

async function loadCurrentUser() {
    const data = await api("/api/auth/me");
    state.currentUser = data.user.username;
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

document.getElementById("socioEditar").addEventListener("change", preencherEdicao);

document.getElementById("formEditarSocio").addEventListener("submit", async (event) => {
    event.preventDefault();
    const memberId = document.getElementById("socioEditar").value;
    const feedback = document.getElementById("feedbackEdicao");
    try {
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
    const ordemPatentes = [
        ["coronel", "Cel"], ["cel ", "Cel"], ["tenente-coronel", "Ten-Cel"], ["ten cel", "Ten-Cel"], ["ten-cel", "Ten-Cel"], ["major", "Maj"], ["maj ", "Maj"], ["capitao", "Cap"], ["cap ", "Cap"],
        ["1 tenente", "1º Ten"], ["1º ten", "1º Ten"], ["primeiro tenente", "1º Ten"], ["2 tenente", "2º Ten"], ["2º ten", "2º Ten"], ["segundo tenente", "2º Ten"],
        ["aspirante", "Asp"], ["asp ", "Asp"], ["subtenente", "Subten"], ["st ", "Subten"], ["1 sargento", "1º Sgt"], ["1º sgt", "1º Sgt"], ["primeiro sargento", "1º Sgt"],
        ["2 sargento", "2º Sgt"], ["2º sgt", "2º Sgt"], ["segundo sargento", "2º Sgt"], ["3 sargento", "3º Sgt"], ["3º sgt", "3º Sgt"], ["terceiro sargento", "3º Sgt"],
        ["cabo", "Cb"], ["cb ", "Cb"], ["soldado", "Sd"], ["sd ", "Sd"]
    ];
    function classificarPosto(member) {
        const nome = displayName(member).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const patente = ordemPatentes.find(([texto]) => nome.includes(texto));
        if (patente) return { grupo: "Militares da ativa", posto: patente[1], ordem: ordemPatentes.indexOf(patente) };
        if (nome.includes("reservista") || nome.includes("reserva")) return { grupo: "Reservistas", posto: "Reservista", ordem: 90 };
        return { grupo: "Civis", posto: "Civil", ordem: 100 };
    }
    const linhas = [...state.members].sort((a, b) => {
        const postoA = classificarPosto(a); const postoB = classificarPosto(b);
        return postoA.ordem - postoB.ordem || displayName(a).localeCompare(displayName(b), "pt-BR");
    }).map((member, indice) => {
        const posto = classificarPosto(member);
        return `<tr><td>${indice + 1}</td><td>${escapeHtml(posto.grupo)}</td><td>${escapeHtml(posto.posto)}</td><td>${escapeHtml(displayName(member))}</td><td>${escapeHtml(member.fullName)}</td><td>${escapeHtml(member.document)}</td><td>${escapeHtml(member.phone || "")}</td><td>${currency.format(member.fee)}</td><td>${currency.format(member.bar)}</td><td><strong>${currency.format(member.total)}</strong></td><td>${member.total === 0 ? "Sem cobrança" : member.paid ? "Pago" : "Pendente"}</td></tr>`;
    }).join("");
    const totalPendente = state.members.filter((member) => !member.paid).reduce((total, member) => total + member.total, 0);
    const totalBar = state.members.reduce((total, member) => total + member.bar, 0);
    const mesFormatado = new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const planilha = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Calibri,Arial;color:#24252a}h1{color:#9b111e;font-size:22px}h2{font-size:14px;color:#666}table{border-collapse:collapse;width:100%}th{background:#9b111e;color:white;padding:9px;border:1px solid #7c0d17}td{padding:7px;border:1px solid #ddd}tr:nth-child(even){background:#f8f8f8}.resumo{background:#f7e6e7;padding:10px;margin-bottom:14px}.pago{color:#168657;font-weight:bold}.pendente{color:#b57613;font-weight:bold}.grupo{font-weight:bold;color:#9b111e}</style></head><body><h1>CSSPP - Relatório de sócios</h1><h2>Competência: ${mesFormatado}</h2><div class="resumo"><b>Sócios:</b> ${state.members.length} &nbsp; | &nbsp; <b>A receber:</b> ${currency.format(totalPendente)} &nbsp; | &nbsp; <b>Total do bar:</b> ${currency.format(totalBar)}</div><table><thead><tr><th>Ordem</th><th>Grupo</th><th>Posto</th><th>Nome de exibição</th><th>Nome completo</th><th>CPF/Matrícula</th><th>WhatsApp</th><th>Mensalidade</th><th>Bar no mês</th><th>Total a cobrar</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table></body></html>`;
    const url = URL.createObjectURL(new Blob(["\uFEFF" + planilha], { type: "application/vnd.ms-excel;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-socios-${month}.xls`;
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
