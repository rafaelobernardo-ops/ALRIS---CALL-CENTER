let sentimentChart = null;
    let recognition = null;
    let isListeningMic = false;
    let activeClientPhone = "5511987654321";
    let currentPlanLimit = 1;
    let currentPlanName = "Starter";
    let activeTeamMembers = [
      { name: "Rafael (Você)", initials: "RC", role: "ADM", color: "bg-blue-600" }
    ];
    let pcCallTimerInterval = null;
    let pcCallSeconds = 0;

    function toggleProfileDropdown() {
      const drop = document.getElementById('profileDropdown');
      if (drop) drop.classList.toggle('hidden');
    }

    function openTeamInviteModal() {
      document.getElementById('teamInviteModal').classList.remove('hidden');
    }

    function closeTeamInviteModal() {
      document.getElementById('teamInviteModal').classList.add('hidden');
    }

    function copyInviteCode() {
      const code = document.getElementById('teamInviteCodeDisplay').innerText;
      if (navigator.clipboard) navigator.clipboard.writeText(code);
      const btn = document.getElementById('btnCopyCode');
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Copiado!`;
      setTimeout(() => {
        btn.innerHTML = `<i class="fa-regular fa-copy"></i> Copiar Código`;
      }, 2000);
    }

    function filterKanbanCards(query) {
      const q = (query || '').toLowerCase().trim();
      const cards = document.querySelectorAll('#view-kanban .pipefy-card');
      cards.forEach(card => {
        const text = card.innerText.toLowerCase();
        card.style.display = (!q || text.includes(q)) ? '' : 'none';
      });
    }

    function renderTeamBar() {
      const container = document.getElementById('activeTeamAvatars');
      const countLabel = document.getElementById('teamCountLabel');
      const limitStr = currentPlanLimit > 20 ? '∞' : currentPlanLimit;
      if (countLabel) countLabel.innerText = `${activeTeamMembers.length}/${limitStr}`;

      if (container) {
        container.innerHTML = activeTeamMembers.map(m => `
          <span class="w-5 h-5 rounded-full ${m.color} text-white font-bold text-[9px] flex items-center justify-center ring-1 ring-slate-900" title="${m.name} (${m.role}) - Online">${m.initials}</span>
        `).join('');
      }
    }

    function addTeamMemberWithCode(e) {
      e.preventDefault();
      if (activeTeamMembers.length >= currentPlanLimit) {
        alert(`Seu plano atual (${currentPlanName}) permite até ${currentPlanLimit} membro(s) ativo(s). Faça o Upgrade para o Plano Pro ou Enterprise para liberar mais vagas com o código de convite!`);
        closeTeamInviteModal();
        openUpgradeModal();
        return;
      }

      const name = document.getElementById('newMemberName').value.trim();
      const role = document.getElementById('newMemberRole').value;
      if (!name) return;

      const colors = ['bg-emerald-600', 'bg-purple-600', 'bg-amber-600', 'bg-cyan-600', 'bg-indigo-600'];
      const color = colors[activeTeamMembers.length % colors.length];
      const initials = name.split(' ').map(p => p[0]).join('').substring(0, 2).toUpperCase();

      activeTeamMembers.push({ name, initials, role, color });
      renderTeamBar();

      document.getElementById('newMemberName').value = '';
      document.getElementById('teamModalPlanTitle').innerText = `Plano Atual: ${currentPlanName} (${activeTeamMembers.length} de ${currentPlanLimit > 20 ? 'Ilimitadas' : currentPlanLimit} vagas usadas)`;
    }

    // Navegação Hierárquica Sequencial:
    // 1. 'landing' (Pública) -> 2. 'login' (Autenticação) -> 3. 'kanban' (Workspace) -> 4. 'callcenter' (Atendimento do Card)
    function goToView(view) {
      const landing = document.getElementById('view-landing');
      const login = document.getElementById('view-login');
      const shell = document.getElementById('workspace-shell');
      const kanban = document.getElementById('view-kanban');
      const callcenter = document.getElementById('view-callcenter');
      const breadcrumb = document.getElementById('workspaceBreadcrumb');

      landing.classList.add('hidden');
      login.classList.add('hidden');
      shell.classList.add('hidden');
      kanban.classList.add('hidden');
      callcenter.classList.add('hidden');

      if (view === 'landing') {
        landing.classList.remove('hidden');
      } else if (view === 'login') {
        login.classList.remove('hidden');
        if (typeof drawLoginFrameOnCanvas === 'function') {
          drawLoginFrameOnCanvas(0);
        }
      } else if (view === 'kanban') {
        shell.classList.remove('hidden');
        kanban.classList.remove('hidden');
        applyWorkspaceHeaderMode('kanban');
        const veil = document.getElementById('workspaceBgVeil');
        if (veil) veil.className = "absolute inset-0 bg-gradient-to-b from-[#0e1014]/50 via-[#0e1014]/20 to-[#0e1014]/55 transition-colors duration-500";
        if (typeof drawWorkspaceFrameOnCanvas === 'function') {
          drawWorkspaceFrameOnCanvas(Math.round(typeof workspaceCurrentFrameFloat !== 'undefined' ? workspaceCurrentFrameFloat : 0));
        }
        if (breadcrumb) breadcrumb.innerText = "Etapa Atual: Quadro Kanban de Processos";
      } else if (view === 'callcenter') {
        shell.classList.remove('hidden');
        callcenter.classList.remove('hidden');
        applyWorkspaceHeaderMode('callcenter');
        const veil = document.getElementById('workspaceBgVeil');
        if (veil) veil.className = "absolute inset-0 bg-white/10 transition-colors duration-500";
        if (typeof drawWorkspaceFrameOnCanvas === 'function') {
          drawWorkspaceFrameOnCanvas(Math.round(typeof workspaceCurrentFrameFloat !== 'undefined' ? workspaceCurrentFrameFloat : 0));
        }
        if (breadcrumb) breadcrumb.innerText = "Etapa Atual: Atendimento ao Vivo & Copiloto IA";
        setTimeout(initSentimentChart, 50);
      }
    }

    let isCallToolbarExpanded = false;

    function toggleCallToolbar(forceState) {
      isCallToolbarExpanded = typeof forceState === 'boolean' ? forceState : !isCallToolbarExpanded;
      const expanded = document.getElementById('callToolbarExpanded');
      const chevron = document.getElementById('callToolbarChevron');
      if (!expanded) return;

      if (isCallToolbarExpanded) {
        expanded.classList.remove('hidden');
        expanded.classList.add('flex');
        if (chevron) chevron.className = "fa-solid fa-chevron-left text-[9px] opacity-75 ml-0.5 transition-transform duration-300";
      } else {
        expanded.classList.remove('flex');
        expanded.classList.add('hidden');
        if (chevron) chevron.className = "fa-solid fa-sliders text-[10px] opacity-75 ml-0.5 transition-transform duration-300";
      }
    }

    function applyWorkspaceHeaderMode(mode) {
      const header = document.getElementById('workspaceHeader');
      const logoText = document.getElementById('workspaceLogoText');
      const logoSub = document.getElementById('workspaceLogoSub');
      const divider = document.getElementById('headerDividerLeft');
      const teamPill = document.getElementById('headerKanbanTeamPill');
      const backBtn = document.getElementById('headerBackKanbanBtn');
      const searchBox = document.getElementById('headerCenterKanban');
      const newTicketBtn = document.getElementById('headerNewTicketBtn');
      const telemetryBtn = document.getElementById('topToggleTelemetryBtn');
      const profileBtn = document.getElementById('profileMenuBtn');
      const userName = document.getElementById('navUserName');
      const island = document.getElementById('callToolbarIsland');

      if (!header) return;

      if (mode === 'callcenter') {
        header.className = "h-18 py-3 bg-white/84 backdrop-blur-2xl text-slate-800 px-6 lg:px-10 flex items-center justify-between border-b border-white/90 shadow-[0_4px_24px_rgba(15,23,42,0.06)] shrink-0 select-none relative z-40 transition-all duration-300 gap-4";
        if (logoText) logoText.className = "alris-logo-font text-xl font-black text-slate-900 leading-none block";
        if (logoSub) logoSub.className = "text-[9px] text-slate-500 font-bold tracking-[0.16em] uppercase mt-0.5";
        if (divider) divider.className = "hidden md:block h-6 w-px bg-slate-300/80";
        if (teamPill) teamPill.className = "hidden";
        if (backBtn) backBtn.className = "flex px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs transition items-center gap-2 border border-slate-200/90 shadow-sm";
        if (searchBox) searchBox.classList.add('hidden');
        if (newTicketBtn) newTicketBtn.classList.add('hidden');
        if (telemetryBtn) {
          telemetryBtn.classList.remove('hidden');
          telemetryBtn.classList.add('flex');
          telemetryBtn.className = "flex px-3.5 py-2 rounded-xl bg-white hover:bg-sky-50 text-slate-800 border border-slate-200/90 font-extrabold transition items-center gap-2 text-xs shadow-sm whitespace-nowrap";
        }
        if (profileBtn) profileBtn.className = "flex items-center gap-2 bg-white hover:bg-slate-50 pl-1.5 pr-3 py-1.5 rounded-xl border border-slate-200/90 shadow-sm transition whitespace-nowrap";
        if (userName) userName.className = "text-xs font-bold text-slate-800 hidden sm:inline";
        if (island) island.className = "flex items-center rounded-full border transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] bg-white/95 border-slate-200/90 text-slate-800 shadow-sm overflow-hidden";
      } else {
        header.className = "h-18 py-3 bg-[#111318]/45 backdrop-blur-xl text-white px-6 lg:px-10 flex items-center justify-between border-b border-white/10 shrink-0 select-none relative z-40 transition-all duration-300 gap-4";
        if (logoText) logoText.className = "alris-logo-font text-xl font-black text-white leading-none block";
        if (logoSub) logoSub.className = "text-[9px] text-slate-300 font-bold tracking-[0.16em] uppercase mt-0.5";
        if (divider) divider.className = "hidden md:block h-6 w-px bg-white/15";
        if (teamPill) teamPill.className = "hidden md:flex items-center bg-white/[0.07] rounded-xl px-3 py-1.5 border border-white/15 gap-2 whitespace-nowrap";
        if (backBtn) backBtn.className = "hidden";
        if (searchBox) searchBox.classList.remove('hidden');
        if (newTicketBtn) newTicketBtn.classList.remove('hidden');
        if (telemetryBtn) {
          telemetryBtn.classList.remove('flex');
          telemetryBtn.classList.add('hidden');
        }
        if (profileBtn) profileBtn.className = "flex items-center gap-2 bg-white/10 hover:bg-white/15 pl-1.5 pr-3 py-1.5 rounded-xl border border-white/15 transition whitespace-nowrap";
        if (userName) userName.className = "text-xs font-bold text-white hidden sm:inline";
        if (island) island.className = "flex items-center rounded-full border transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] bg-white/10 border-white/20 text-white shadow-sm overflow-hidden";
      }
    }

    let isTelemetryExpanded = false;

    function toggleTelemetryPanel(forceState) {
      isTelemetryExpanded = typeof forceState === 'boolean' ? forceState : !isTelemetryExpanded;
      const wrap = document.getElementById('telemetryColWrap');
      const dock = document.getElementById('telemetryMinimizedDock');
      const maxContent = document.getElementById('telemetryMaximizedContent');
      const topBtnText = document.getElementById('topToggleTelemetryText');
      const expandHint = document.getElementById('listeningExpandHint');

      if (!wrap || !dock || !maxContent) return;

      if (isTelemetryExpanded) {
        wrap.className = "w-full lg:w-[25%] shrink-0 flex flex-col overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]";
        dock.classList.add('hidden');
        maxContent.classList.remove('hidden');
        maxContent.classList.add('flex');
        requestAnimationFrame(() => {
          maxContent.classList.remove('opacity-0', 'scale-95');
          maxContent.classList.add('opacity-100', 'scale-100');
        });
        if (topBtnText) topBtnText.innerText = "Minimizar Telemetria";
        if (expandHint) expandHint.classList.add('hidden');
      } else {
        wrap.className = "w-full lg:w-[60px] shrink-0 flex flex-col overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]";
        maxContent.classList.remove('opacity-100', 'scale-100', 'flex');
        maxContent.classList.add('opacity-0', 'scale-95', 'hidden');
        dock.classList.remove('hidden');
        if (topBtnText) topBtnText.innerText = "Abrir Telemetria & Conversão";
        if (expandHint) expandHint.classList.remove('hidden');
      }
    }

    let selectedCheckoutPlanName = "Plano Pro Growth";
    let selectedCheckoutPlanPrice = "299,00";
    let selectedCheckoutPlanSeats = 5;

    function openPaymentCheckout(planName, priceStr, seatsLimit) {
      selectedCheckoutPlanName = planName;
      selectedCheckoutPlanPrice = priceStr;
      selectedCheckoutPlanSeats = seatsLimit;

      document.getElementById('upgradeModal').classList.remove('hidden');
      document.getElementById('upgradeStepPlans').classList.add('hidden');
      document.getElementById('upgradeStepCheckout').classList.remove('hidden');

      document.getElementById('checkoutPlanTitle').innerText = planName;
      document.getElementById('checkoutPlanPrice').innerText = priceStr;
      document.getElementById('checkoutPlanSeats').innerText = seatsLimit > 20 ? 'Ilimitados (∞)' : `Até ${seatsLimit} membro(s)`;
    }

    function backToPlanSelection() {
      document.getElementById('upgradeStepCheckout').classList.add('hidden');
      document.getElementById('upgradeStepPlans').classList.remove('hidden');
    }

    function switchPaymentTab(tab) {
      const pixBox = document.getElementById('paymentTabPix');
      const cardBox = document.getElementById('paymentTabCard');
      const btnPix = document.getElementById('tabBtnPix');
      const btnCard = document.getElementById('tabBtnCard');

      if (tab === 'pix') {
        pixBox.classList.remove('hidden');
        cardBox.classList.add('hidden');
        btnPix.className = "py-2.5 px-3 rounded-xl font-extrabold text-xs bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-sm transition flex items-center justify-center gap-1.5";
        btnCard.className = "py-2.5 px-3 rounded-xl font-bold text-xs text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1.5";
      } else {
        pixBox.classList.add('hidden');
        cardBox.classList.remove('hidden');
        btnCard.className = "py-2.5 px-3 rounded-xl font-extrabold text-xs bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-sm transition flex items-center justify-center gap-1.5";
        btnPix.className = "py-2.5 px-3 rounded-xl font-bold text-xs text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1.5";
      }
    }

    function copyPixCode() {
      const pixInput = document.getElementById('pixCopyInput');
      if (navigator.clipboard && pixInput) navigator.clipboard.writeText(pixInput.value);
      const btn = document.getElementById('btnCopyPix');
      btn.innerHTML = `<i class="fa-solid fa-check text-cyan-400"></i> Copiado!`;
      setTimeout(() => {
        btn.innerHTML = `<i class="fa-regular fa-copy"></i> Copiar Pix`;
      }, 2000);
    }

    function processFinalPayment(methodLabel) {
      const btnPix = document.getElementById('btnConfirmPixPay');
      const btnCard = document.getElementById('btnConfirmCardPay');
      if (btnPix) btnPix.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Validando Pagamento (${methodLabel})...`;
      if (btnCard) btnCard.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processando Cartão...`;

      setTimeout(() => {
        confirmSubscriptionUpgrade(`${selectedCheckoutPlanName} (R$ ${selectedCheckoutPlanPrice}/mês via ${methodLabel})`);
        if (btnPix) btnPix.innerHTML = `<i class="fa-solid fa-circle-check"></i> Pagamento Aprovado — Plano Ativo!`;
        if (btnCard) btnCard.innerHTML = `<i class="fa-solid fa-circle-check"></i> Assinatura Ativada no Cartão!`;
      }, 650);
    }

    function selectPlan(planName) {
      if (planName.includes('Starter')) {
        openPaymentCheckout('Plano Starter', '149,00', 1);
      } else if (planName.includes('Enterprise')) {
        openPaymentCheckout('Plano Enterprise Scale', '699,00', 99);
      } else {
        openPaymentCheckout('Plano Pro Growth', '299,00', 5);
      }
    }

    function switchLoginMode(mode) {
      const boxAdmin = document.getElementById('loginBoxAdmin');
      const boxTeam = document.getElementById('loginBoxTeam');
      const btnAdmin = document.getElementById('btnModeAdmin');
      const btnTeam = document.getElementById('btnModeTeam');
      const mainCard = document.getElementById('loginMainCard');
      const mainCardInner = document.getElementById('loginMainCardInner');
      const tabsWrap = document.getElementById('loginModeTabsWrap');

      if (mode === 'admin') {
        boxAdmin.classList.remove('hidden');
        boxTeam.classList.add('hidden');
        if (mainCard) {
          mainCard.className = "bg-[#15181f]/45 hover:bg-[#15181f]/55 backdrop-blur-xl w-full max-w-md rounded-3xl shadow-[0_28px_70px_rgba(0,0,0,0.75)] overflow-hidden border border-white/20 ring-1 ring-white/10 transition-all duration-300";
        }
        if (mainCardInner) {
          mainCardInner.className = "p-6 sm:p-7 text-xs text-slate-100";
        }
        if (tabsWrap) {
          tabsWrap.className = "grid grid-cols-2 gap-2 p-1.5 bg-[#0e1014]/80 rounded-2xl border border-white/15 mb-6 shadow-inner transition-all duration-300";
        }
        btnAdmin.className = "py-2.5 px-3 rounded-xl font-extrabold text-xs bg-gradient-to-r from-white via-slate-100 to-slate-300 text-[#0e1014] shadow-md transition-all duration-300 flex items-center justify-center gap-1.5";
        btnTeam.className = "py-2.5 px-3 rounded-xl font-bold text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-all duration-300 flex items-center justify-center gap-1.5";
      } else {
        boxAdmin.classList.add('hidden');
        boxTeam.classList.remove('hidden');
        if (mainCard) {
          mainCard.className = "bg-white/90 hover:bg-white/95 backdrop-blur-2xl w-full max-w-md rounded-3xl shadow-[0_28px_70px_rgba(0,0,0,0.75)] overflow-hidden border-2 border-white ring-1 ring-slate-200 transition-all duration-300";
        }
        if (mainCardInner) {
          mainCardInner.className = "p-6 sm:p-7 text-xs text-[#0e1014]";
        }
        if (tabsWrap) {
          tabsWrap.className = "grid grid-cols-2 gap-2 p-1.5 bg-slate-200/90 rounded-2xl border border-slate-300 mb-6 shadow-inner transition-all duration-300";
        }
        btnTeam.className = "py-2.5 px-3 rounded-xl font-extrabold text-xs bg-[#0e1014] text-white shadow-md transition-all duration-300 flex items-center justify-center gap-1.5";
        btnAdmin.className = "py-2.5 px-3 rounded-xl font-bold text-xs text-slate-700 hover:text-[#0e1014] hover:bg-black/5 transition-all duration-300 flex items-center justify-center gap-1.5";
      }
      if (typeof drawLoginFrameOnCanvas === 'function' && typeof lastDrawnLoginSeqIndex !== 'undefined') {
        drawLoginFrameOnCanvas(Math.max(0, lastDrawnLoginSeqIndex));
      }
    }

    function switchAdminAuthTab(tab) {
      const loginWrap = document.getElementById('adminFormLoginWrap');
      const regWrap = document.getElementById('adminFormRegisterWrap');
      const forgotWrap = document.getElementById('adminFormForgotWrap');
      const btnLogin = document.getElementById('btnAdminSubLogin');
      const btnReg = document.getElementById('btnAdminSubRegister');
      const titleEl = document.getElementById('adminAuthTitle');

      loginWrap?.classList.add('hidden');
      regWrap?.classList.add('hidden');
      forgotWrap?.classList.add('hidden');

      if (tab === 'forgot') {
        forgotWrap?.classList.remove('hidden');
        const loginEmail = document.getElementById('loginEmail')?.value.trim();
        const forgotInput = document.getElementById('forgotEmailInput');
        if (forgotInput && loginEmail && !forgotInput.value) forgotInput.value = loginEmail;
        const btnForgot = document.getElementById('btnForgotSubmit');
        if (btnForgot) {
          btnForgot.disabled = false;
          btnForgot.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar Link de Recuperação';
        }
        return;
      }

      if (tab === 'register') {
        loginWrap?.classList.add('hidden');
        regWrap?.classList.remove('hidden');
        if (titleEl) titleEl.innerText = 'Cadastro do Administrador';
        if (btnReg) btnReg.className = "px-3 py-1.5 rounded-lg font-extrabold text-[11px] bg-white text-[#0e1014] shadow transition-all";
        if (btnLogin) btnLogin.className = "px-3 py-1.5 rounded-lg font-bold text-[11px] text-slate-300 hover:text-white transition-all";
      } else {
        regWrap?.classList.add('hidden');
        loginWrap?.classList.remove('hidden');
        if (titleEl) titleEl.innerText = 'Login do Administrador';
        if (btnLogin) btnLogin.className = "px-3 py-1.5 rounded-lg font-extrabold text-[11px] bg-white text-[#0e1014] shadow transition-all";
        if (btnReg) btnReg.className = "px-3 py-1.5 rounded-lg font-bold text-[11px] text-slate-300 hover:text-white transition-all";
      }
    }

    function switchTeamAuthTab(tab) {
      const extraFields = document.getElementById('teamRegisterExtraFields');
      const btnLogin = document.getElementById('btnTeamSubLogin');
      const btnReg = document.getElementById('btnTeamSubRegister');
      const titleEl = document.getElementById('teamAuthTitle');
      const submitBtn = document.getElementById('btnTeamSubmitMain');

      if (tab === 'register') {
        extraFields?.classList.remove('hidden');
        if (titleEl) titleEl.innerText = 'Primeiro Cadastro na Equipe';
        if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Concluir Cadastro & Entrar na Equipe';
        if (btnReg) btnReg.className = "px-3 py-1.5 rounded-lg font-extrabold text-[11px] bg-[#0e1014] text-white shadow transition-all";
        if (btnLogin) btnLogin.className = "px-3 py-1.5 rounded-lg font-bold text-[11px] text-slate-600 hover:text-[#0e1014] transition-all";
      } else {
        extraFields?.classList.add('hidden');
        if (titleEl) titleEl.innerText = 'Entrar na Equipe com Código';
        if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-users"></i> Validar Código e Entrar na Equipe';
        if (btnLogin) btnLogin.className = "px-3 py-1.5 rounded-lg font-extrabold text-[11px] bg-[#0e1014] text-white shadow transition-all";
        if (btnReg) btnReg.className = "px-3 py-1.5 rounded-lg font-bold text-[11px] text-slate-600 hover:text-[#0e1014] transition-all";
      }
    }

    function showAlrisToast(title, message) {
      let toast = document.getElementById('alrisToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'alrisToast';
        toast.className = 'fixed top-6 left-1/2 -translate-x-1/2 z-[9999] w-[92%] max-w-md px-5 py-4 rounded-2xl bg-[#15181f]/90 backdrop-blur-xl border border-white/25 shadow-[0_20px_50px_rgba(0,0,0,0.7)] text-white flex items-start gap-3 transition-all duration-500 opacity-0 -translate-y-4';
        document.body.appendChild(toast);
      }
      toast.innerHTML = `
        <div class="w-9 h-9 shrink-0 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
          <i class="fa-solid fa-envelope-circle-check text-white"></i>
        </div>
        <div class="text-xs leading-relaxed">
          <strong class="block text-sm font-extrabold mb-0.5">${title}</strong>
          <span class="text-slate-200">${message}</span>
        </div>`;
      requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', '-translate-y-4');
      });
      clearTimeout(toast._hideTimer);
      toast._hideTimer = setTimeout(() => {
        toast.classList.add('opacity-0', '-translate-y-4');
      }, 4500);
    }

    function handleForgotPassword(e) {
      if (e) e.preventDefault();
      const email = document.getElementById('forgotEmailInput')?.value.trim();
      if (!email) return;
      const btn = document.getElementById('btnForgotSubmit');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Link Enviado!';
      }
      showAlrisToast(
        'Link de recuperação enviado!',
        `Se <strong class="text-white">${email}</strong> estiver cadastrado, você receberá em instantes um link para criar uma nova senha. Verifique também a caixa de spam.`
      );
      setTimeout(() => switchAdminAuthTab('login'), 3200);
    }

    async function handleAdminRegister(e) {
      if (e) e.preventDefault();
      const company = document.getElementById('adminCompanyInput')?.value.trim() || 'Minha Empresa';
      const name = document.getElementById('adminNameInput')?.value.trim() || 'Administrador';
      const email = document.getElementById('regAdminEmail')?.value.trim().toLowerCase() || 'seu e-mail corporativo';
      const phone = document.getElementById('regAdminPhone')?.value.trim() || '';
      const pass = document.getElementById('regAdminPass')?.value || '';
      const passConfirm = document.getElementById('regAdminPassConfirm')?.value || '';

      if (pass !== passConfirm) {
        showAlrisToast('As senhas não conferem', 'Verifique a senha e a confirmação antes de concluir o cadastro.');
        return;
      }

      const loginEmailEl = document.getElementById('loginEmail');
      if (loginEmailEl) loginEmailEl.value = email;

      try {
        const res = await fetch('/api/register-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company, name, email, phone, password: pass })
        });
        const data = await res.json();
        if (data && data.success) {
          showAlrisToast(
            'Link de confirmação enviado!',
            `Enviamos um token seguro para <strong class="text-white">${email}</strong>. Confirme seu e-mail corporativo antes de fazer login no painel.`
          );
        } else {
          showAlrisToast(
            'Cadastro realizado!',
            `Enviamos um link de confirmação para <strong class="text-white">${email}</strong>. Confirme o e-mail para ativar sua conta.`
          );
        }
      } catch (err) {
        showAlrisToast(
          'Cadastro realizado!',
          `Enviamos um link de confirmação para <strong class="text-white">${email}</strong>. Confirme o e-mail para ativar sua conta.`
        );
      }

      switchAdminAuthTab('login');
      // Redireciona de volta para a página inicial (landing page), sem entrar no Kanban
      goToView('landing');
    }

    function handleAdminLogin(e) {
      if (e) e.preventDefault();
      const company = document.getElementById('adminCompanyInput') ? document.getElementById('adminCompanyInput').value.trim() : "Agência Rafael Tech";
      const adminName = document.getElementById('adminNameInput') ? document.getElementById('adminNameInput').value.trim() : "Rafael";
      const initials = adminName.substring(0, 2).toUpperCase();

      document.getElementById('navAvatar').innerText = initials;
      document.getElementById('navUserName').innerText = `${adminName} (ADM)`;
      if (document.getElementById('dropUserName')) {
        document.getElementById('dropUserName').innerText = `${adminName} — ${company}`;
      }
      renderTeamBar();
      goToView('kanban');
    }

    function loginDemoAdmin() {
      // Conta Demo Administrador já com Plano Pro (5 vagas liberadas e equipe ativa para demonstração)
      currentPlanName = "Pro Growth (Demo)";
      currentPlanLimit = 5;
      activeTeamMembers = [
        { name: "Rafael (Admin Demo)", initials: "RC", role: "ADM", color: "bg-blue-600" },
        { name: "Lucas Torres", initials: "LT", role: "Vendas", color: "bg-cyan-600" },
        { name: "Mariana Alves", initials: "MA", role: "Design", color: "bg-purple-600" }
      ];
      document.getElementById('navAvatar').innerText = "RC";
      document.getElementById('navUserName').innerText = "Rafael (ADM Demo)";
      if (document.getElementById('topPlanBadge')) {
        document.getElementById('topPlanBadge').className = "text-[10px] bg-cyan-500/20 text-cyan-300 font-bold px-2 py-0.5 rounded border border-cyan-400/30";
        document.getElementById('topPlanBadge').innerText = "PRO DEMO (3/5)";
      }
      if (document.getElementById('dropPlanInfo')) {
        document.getElementById('dropPlanInfo').innerText = "Plano: Pro Growth Demo (Até 5 membros)";
      }
      renderTeamBar();
      goToView('kanban');
    }

    function sendConfirmationEmailDemo() {
      const email = document.getElementById('loginEmail') ? document.getElementById('loginEmail').value : "rafael@alris.com.br";
      const btn = document.getElementById('btnEmailConfirm');
      if (!btn) { alert(`Link de redefinição enviado para ${email}`); return; }
      btn.className = "w-full py-2 px-3 rounded-lg bg-cyan-100 text-cyan-900 border border-cyan-300 font-bold text-[11px] transition flex items-center justify-center gap-1.5";
      btn.innerHTML = `<i class="fa-solid fa-check-double"></i> Link de Confirmação Enviado para ${email}!`;
    }

    function handleTeamCodeLogin(e) {
      if (e) e.preventDefault();
      const code = document.getElementById('teamCodeInput').value.trim().toUpperCase();
      const memberName = document.getElementById('memberLoginName').value.trim() || "Colaborador";
      const memberRole = document.getElementById('memberLoginRole').value;
      const initials = memberName.split(' ').map(p => p[0]).join('').substring(0, 2).toUpperCase();

      if (!code.startsWith('ALRIS-') && !code.startsWith('CONV-')) {
        alert('Código inválido! Use o código fornecido pelo Administrador (ex: ALRIS-8842-TEAM).');
        return;
      }

      const extraFields = document.getElementById('teamRegisterExtraFields');
      const isRegistering = extraFields && !extraFields.classList.contains('hidden');

      if (isRegistering) {
        showAlrisToast(
          'Cadastro de Equipe Concluído!',
          `Seu registro foi vinculado ao código <strong class="text-white">${code}</strong>. Faça login com suas credenciais para acessar.`
        );
        switchTeamAuthTab('login');
        goToView('landing');
        return;
      }

      // Garante vaga para demonstração quando entra via código
      if (currentPlanLimit < 5) {
        currentPlanLimit = 5;
        currentPlanName = "Pro Growth";
      }

      const exists = activeTeamMembers.some(m => m.name.toLowerCase() === memberName.toLowerCase());
      if (!exists) {
        activeTeamMembers.push({ name: memberName, initials, role: memberRole, color: "bg-purple-600" });
      }

      document.getElementById('navAvatar').innerText = initials;
      document.getElementById('navUserName').innerText = `${memberName} (Equipe)`;
      if (document.getElementById('dropUserName')) {
        document.getElementById('dropUserName').innerText = `${memberName} — ${memberRole}`;
      }
      if (document.getElementById('topPlanBadge')) {
        document.getElementById('topPlanBadge').className = "text-[10px] bg-cyan-500/20 text-cyan-300 font-bold px-2 py-0.5 rounded border border-cyan-400/30";
        document.getElementById('topPlanBadge').innerText = `CÓDIGO: ${code}`;
      }
      renderTeamBar();
      goToView('kanban');
    }

    function handleUserLogin(e) {
      handleAdminLogin(e);
    }

    function quickLogin(name, initials) {
      loginDemoAdmin();
    }

    let isRecordingCall = false;

    function toggleCallRecording() {
      isRecordingCall = !isRecordingCall;
      const dot = document.getElementById('recordDot');
      const txt = document.getElementById('recordBtnText');
      if (isRecordingCall) {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-rose-500 animate-ping";
        if (txt) txt.innerText = "Gravando...";
      } else {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-slate-400";
        if (txt) txt.innerText = "Gravar";
      }
    }

    function endActiveCall() {
      if (pcCallTimerInterval) {
        clearInterval(pcCallTimerInterval);
        pcCallTimerInterval = null;
      }
      if (isListeningMic && recognition) {
        recognition.stop();
        isListeningMic = false;
      }
      const timerTxt = document.getElementById('topCallTimerText');
      if (timerTxt) timerTxt.innerText = "Chamada Finalizada";
      const badge = document.getElementById('callActiveBadge');
      if (badge) {
        badge.className = "px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-bold text-[10px]";
        badge.innerText = "Encerrada";
      }
    }

    function updateChecklistProgress() {
      const checks = document.querySelectorAll('.chk-item');
      let done = 0;
      checks.forEach(c => { if (c.checked) done++; });
      const total = checks.length || 3;
      const pct = Math.round((done / total) * 100);
      const titleEl = document.getElementById('checklistTitleText');
      const barEl = document.getElementById('checklistProgressBar');
      const pctEl = document.getElementById('checklistPercentText');
      if (titleEl) titleEl.innerText = `CHECKLIST DO ATENDIMENTO (${done}/${total} CONCLUÍDO)`;
      if (barEl) barEl.style.width = `${pct}%`;
      if (pctEl) pctEl.innerText = `${pct}%`;
    }

    // Abre o Atendimento ao Vivo específico do Card clicado no Kanban
    function openClientAttendance(name, company, phone, channel, inventory, pain) {
      activeClientPhone = phone.replace(/\D/g, '') || "5511987654321";
      document.getElementById('liveCardName').innerText = name;
      document.getElementById('liveCardCompany').innerText = company;
      document.getElementById('liveCardPhone').innerText = phone.startsWith('+') ? phone : `+${phone}`;
      document.getElementById('liveCardChannel').innerText = channel;
      document.getElementById('liveCardInventory').innerText = inventory;
      document.getElementById('liveCardPain').innerText = `"${pain}"`;
      document.getElementById('liveAvatar').innerText = name.substring(0, 2).toUpperCase();
      const firstName = name.split(' ')[0];
      const lbl = document.getElementById('transcriptClientLabel');
      if (lbl) lbl.innerText = `Cliente (${firstName})`;

      const badge = document.getElementById('callActiveBadge');
      if (badge) {
        badge.className = "px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px]";
        badge.innerText = "Ligação Ativa";
      }

      goToView('callcenter');
    }

    function copyClientPhone() {
      const formatted = `+${activeClientPhone}`;
      if (navigator.clipboard) navigator.clipboard.writeText(formatted);
      const b1 = document.getElementById('btnCopyCardPhone');
      const b2 = document.getElementById('btnCopyModalPhone');
      if (b1) {
        b1.innerHTML = `<i class="fa-solid fa-check text-emerald-600"></i> Copiado!`;
        setTimeout(() => { b1.innerHTML = `<i class="fa-regular fa-copy"></i> Copiar`; }, 2000);
      }
      if (b2) {
        b2.innerHTML = `<i class="fa-solid fa-check"></i> Número Copiado!`;
        setTimeout(() => { b2.innerHTML = `<i class="fa-regular fa-copy"></i> Copiar Número`; }, 2000);
      }
    }

    function closeVoipDialerModal() {
      const m = document.getElementById('voipDialerModal');
      if (m) m.classList.add('hidden');
    }

    function triggerSystemTelCall() {
      window.location.href = `tel:+${activeClientPhone}`;
      closeVoipDialerModal();
    }

    function startNormalPhoneCall() {
      const name = document.getElementById('liveCardName').innerText;
      const phone = activeClientPhone;
      const btn = document.getElementById('btnNormalCall');
      const softLine = document.getElementById('softphoneStatusLine');
      const timerTxt = document.getElementById('topCallTimerText');

      const dName = document.getElementById('dialerClientName');
      const dPhone = document.getElementById('dialerPhoneDisplay');
      if (dName) dName.innerText = name;
      if (dPhone) dPhone.innerText = `+${phone}`;
      const modal = document.getElementById('voipDialerModal');
      if (modal) modal.classList.remove('hidden');

      if (!pcCallTimerInterval) {
        pcCallSeconds = 252;
        btn.className = "w-8 h-8 rounded-lg bg-blue-600 text-white border border-blue-700 flex items-center justify-center transition shadow-sm animate-pulse";

        pcCallTimerInterval = setInterval(() => {
          pcCallSeconds++;
          const mins = String(Math.floor(pcCallSeconds / 60)).padStart(2, '0');
          const secs = String(pcCallSeconds % 60).padStart(2, '0');
          if (timerTxt) timerTxt.innerText = `Em Atendimento • ${mins}:${secs}`;
          if (softLine) softLine.innerText = `VoIP WebRTC Conectado (${mins}:${secs})`;
        }, 1000);
      }
      
      if (!isListeningMic) toggleRealMicrophone();

      const box = document.getElementById('transcriptBox');
      box.innerHTML += `
        <div class="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-center text-[11px] font-bold text-blue-800">
          <i class="fa-solid fa-headset mr-1"></i> Central VoIP & Microfone IA ativados para ${name} (+${phone})!
        </div>
      `;
      box.scrollTop = box.scrollHeight;
    }

    function startWhatsAppCall() {
      const name = document.getElementById('liveCardName').innerText;
      const phone = activeClientPhone;
      const btn = document.getElementById('btnWhatsCall');

      btn.className = "w-8 h-8 rounded-lg bg-emerald-600 text-white border border-emerald-700 flex items-center justify-center transition shadow-sm";

      if (!isListeningMic) toggleRealMicrophone();

      const msgText = `Olá ${name}, tudo bem? Estou entrando em contato sobre o novo site da sua empresa!`;
      const webUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msgText)}`;

      const box = document.getElementById('transcriptBox');
      box.innerHTML += `
        <div class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-center text-[11px] font-bold text-emerald-800">
          <i class="fa-brands fa-whatsapp mr-1"></i> WhatsApp Web aberto diretamente no navegador para ${name} (+${phone}) — IA escutando em tempo real...
        </div>
      `;
      box.scrollTop = box.scrollHeight;
      window.open(webUrl, '_blank');
    }

    function sendWhatsAppContract() {
      const name = document.getElementById('liveCardName').innerText;
      const company = document.getElementById('liveCardCompany').innerText;
      const phone = activeClientPhone;

      const chkClose = document.getElementById('chkClosing');
      if (chkClose) {
        chkClose.checked = true;
        updateChecklistProgress();
      }

      simulateEvent('positive_close');

      const msg = `Olá ${name}! Conforme conversamos na ligação, segue a proposta oficial e o contrato para o novo site de alta conversão da *${company}*:\n\n✅ Layout Mobile Ultrarrápido (abertura < 1s)\n✅ Integração Direta com WhatsApp e Instagram\n✅ Condição aprovada: 3x sem juros\n\n👉 *Clique aqui para assinar digitalmente e confirmar:* https://alris.com.br/contrato/${encodeURIComponent(company.toLowerCase().replace(/\s+/g, '-'))}`;

      window.open(`https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`, '_blank');
    }

    function openUpgradeModal() {
      document.getElementById('upgradeModal').classList.remove('hidden');
    }

    function closeUpgradeModal() {
      document.getElementById('upgradeModal').classList.add('hidden');
    }

    function confirmSubscriptionUpgrade(planName) {
      if (planName.includes('Pro')) {
        currentPlanLimit = 5;
        currentPlanName = "Pro Team";
        if (activeTeamMembers.length < 3) {
          activeTeamMembers = [
            { name: "Rafael (Você)", initials: "RC", role: "ADM", color: "bg-blue-600" },
            { name: "Lucas Torres", initials: "LT", role: "Vendas", color: "bg-emerald-600" },
            { name: "Mariana Alves", initials: "MA", role: "Design", color: "bg-purple-600" }
          ];
        }
      } else if (planName.includes('Enterprise')) {
        currentPlanLimit = 99;
        currentPlanName = "Enterprise";
      } else {
        currentPlanLimit = 1;
        currentPlanName = "Starter";
      }

      renderTeamBar();
      const limitStr = currentPlanLimit > 20 ? '∞' : currentPlanLimit;
      if (document.getElementById('topPlanBadge')) {
        document.getElementById('topPlanBadge').className = "text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded border border-emerald-400/30";
        document.getElementById('topPlanBadge').innerText = `${currentPlanName.toUpperCase()} (${activeTeamMembers.length}/${limitStr})`;
      }
      if (document.getElementById('dropPlanInfo')) {
        document.getElementById('dropPlanInfo').innerText = `Plano Atual: ${currentPlanName} (Limite ${limitStr} membros)`;
      }
      if (document.getElementById('teamModalPlanTitle')) {
        document.getElementById('teamModalPlanTitle').innerText = `Plano Atual: ${currentPlanName} (${activeTeamMembers.length} de ${limitStr} vagas usadas)`;
      }

      const box = document.getElementById('checkoutBox');
      box.className = "p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-400 flex flex-wrap items-center justify-between gap-4";
      box.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-lg">
            <i class="fa-solid fa-check-double"></i>
          </div>
          <div>
            <strong class="text-emerald-950 block text-sm">Assinatura Confirmada: ${planName}!</strong>
            <span class="text-xs text-emerald-700">Limite de equipe atualizado (${limitStr} vagas) e código de convite CONV-8842-TEAM liberado!</span>
          </div>
        </div>
        <button onclick="closeUpgradeModal()" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow">
          Continuar Usando Painel &rarr;
        </button>
      `;
    }

    function openApiModal() {
      const savedKey = localStorage.getItem('APEX_GEMINI_KEY') || '';
      document.getElementById('geminiApiKeyInput').value = savedKey;
      document.getElementById('apiModal').classList.remove('hidden');
    }

    function closeApiModal() {
      document.getElementById('apiModal').classList.add('hidden');
    }

    function saveApiKey() {
      const key = document.getElementById('geminiApiKeyInput').value.trim();
      const model = document.getElementById('geminiModelSelect').value;
      const statusTxt = document.getElementById('apiStatusText');
      if (key) {
        localStorage.setItem('APEX_GEMINI_KEY', key);
        localStorage.setItem('APEX_GEMINI_MODEL', model);
        if (statusTxt) {
          statusTxt.innerText = 'Ativa';
          statusTxt.className = 'text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-extrabold';
        }
      } else {
        localStorage.removeItem('APEX_GEMINI_KEY');
        if (statusTxt) {
          statusTxt.innerText = 'Padrão';
          statusTxt.className = 'text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold';
        }
      }
      closeApiModal();
    }

    async function callRealGeminiAPI(customerSpeech) {
      const apiKey = localStorage.getItem('APEX_GEMINI_KEY');
      const model = localStorage.getItem('APEX_GEMINI_MODEL') || 'gemini-2.5-flash';
      const clientCompany = document.getElementById('liveCardCompany').innerText;

      if (apiKey) {
        try {
          const prompt = `Você é um Copiloto de Vendas em tempo real falando com o cliente da empresa "${clientCompany}".
O cliente acabou de dizer: "${customerSpeech}"
Responda APENAS com um objeto JSON válido:
{
  "probabilidade": <numero de 10 a 98>,
  "status_curto": "<ex: Objeção de Preço | Dúvida de Prazo | Sinal de Compra | Risco de Perda>",
  "tom_cliente": "<ex: Cauteloso | Interessado | Resistente | Decidido>",
  "sugestao_fala": "<frase persuasiva e direta que o vendedor deve falar agora para converter o cliente>"
}`;
          const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json" }
            })
          });
          if (resp.ok) {
            const data = await resp.json();
            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawText) return JSON.parse(rawText);
          }
        } catch (err) {
          console.warn('Fallback local:', err);
        }
      }

      const lower = customerSpeech.toLowerCase();
      if (lower.includes('caro') || lower.includes('preço') || lower.includes('valor') || lower.includes('desconto')) {
        return {
          probabilidade: 38,
          status_curto: 'Área de Risco: Preço',
          tom_cliente: 'Resistente a Preço',
          sugestao_fala: `"Entendo sua cautela com o investimento. Mas pense comigo: um site lento faz você perder clientes todos os dias. Se parcelarmos em 3x sem juros e o novo site te trouxer apenas 1 cliente novo nesta semana, o projeto já se paga sozinho. Vamos fechar assim?"`
        };
      } else if (lower.includes('pensar') || lower.includes('sócio') || lower.includes('depois')) {
        return {
          probabilidade: 44,
          status_curto: 'Risco: Adiamento',
          tom_cliente: 'Indeciso / Adiando',
          sugestao_fala: `"Claro! Qual é a principal dúvida que você e seu sócio ainda têm? Se eu liberar um bônus de 30 dias de suporte VIP e hospedagem gratuita para fecharmos hoje, ajuda vocês a baterem o martelo?"`
        };
      } else if (lower.includes('fechar') || lower.includes('gostei') || lower.includes('manda') || lower.includes('contrato')) {
        return {
          probabilidade: 95,
          status_curto: 'Venda Convertida!',
          tom_cliente: 'Decidido / Pronto',
          sugestao_fala: `"Excelente decisão! Já estou clicando aqui para enviar o contrato e o link no seu WhatsApp agora mesmo!"`
        };
      } else {
        return {
          probabilidade: 68,
          status_curto: 'Em Negociação Ativa',
          tom_cliente: 'Analítico / Avaliando',
          sugestao_fala: `"Perfeito! Nós entregamos o projeto 100% adaptado para celular, integrado ao WhatsApp e puxando os dados do seu Instagram automaticamente. Prefere fazer em 3x sem juros ou à vista com desconto?"`
        };
      }
    }

    async function analyzeCustomCustomerSpeech(e) {
      if (e) e.preventDefault();
      const input = document.getElementById('customSpeechInput');
      const speech = input.value.trim();
      if (!speech) return;

      const btn = document.getElementById('btnAnalyzeSpeech');
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

      const box = document.getElementById('transcriptBox');
      const clientName = document.getElementById('liveCardName').innerText.split(' ')[0];
      box.innerHTML += `
        <div class="flex flex-col items-start">
          <span class="text-[10px] font-bold text-slate-600 mb-1">Cliente (${clientName})</span>
          <div class="max-w-[90%] p-3.5 rounded-2xl rounded-tl-sm bg-white border border-slate-200 text-slate-800 leading-relaxed shadow-sm">
            "${speech}"
          </div>
          <span class="text-[10px] text-slate-400 mt-1 font-mono">Agora</span>
        </div>
      `;
      box.scrollTop = box.scrollHeight;
      input.value = '';

      const result = await callRealGeminiAPI(speech);

      document.getElementById('pitchLine').innerHTML = result.sugestao_fala;
      document.getElementById('aiAlertBadge').innerText = `${result.status_curto}`;
      document.getElementById('clientTone').innerText = result.tom_cliente;

      const color = result.probabilidade < 45 ? '#e11d48' : (result.probabilidade < 75 ? '#d97706' : '#059669');
      const bg = result.probabilidade < 45 ? 'rgba(225, 29, 72, 0.15)' : (result.probabilidade < 75 ? 'rgba(217, 119, 6, 0.15)' : 'rgba(5, 150, 105, 0.15)');
      updateTelemetry(result.probabilidade, result.status_curto, color, bg, 'Fala Real');

      btn.innerHTML = `Analisar`;
    }

    function toggleRealMicrophone() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert('Use a barra de texto abaixo da transcrição para testar qualquer frase no seu navegador!');
        return;
      }

      const btn = document.getElementById('realMicBtn');
      const txt = document.getElementById('realMicText');

      if (isListeningMic && recognition) {
        recognition.stop();
        isListeningMic = false;
        if (btn) btn.className = "px-2.5 py-1 rounded-lg bg-[#232f49] hover:bg-slate-700 text-slate-200 border border-slate-600/60 font-semibold text-[10px] transition flex items-center gap-1.5";
        if (txt) txt.innerText = "Microfone";
        return;
      }

      recognition = new SpeechRecognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onstart = () => {
        isListeningMic = true;
        if (btn) btn.className = "px-2.5 py-1 rounded-lg bg-cyan-600 text-white font-bold text-[10px] transition flex items-center gap-1.5 animate-pulse shadow";
        if (txt) txt.innerText = "Ouvindo...";
      };

      recognition.onresult = (event) => {
        const lastResult = event.results[event.results.length - 1];
        if (lastResult.isFinal) {
          document.getElementById('customSpeechInput').value = lastResult[0].transcript;
          analyzeCustomCustomerSpeech();
        }
      };

      recognition.onerror = () => {
        isListeningMic = false;
        if (txt) txt.innerText = "Microfone";
      };

      recognition.start();
    }

    function initSentimentChart() {
      // Gráfico de onda SVG dinâmico já renderizado diretamente no DOM
    }

    function changePitch(mode) {
      const pitch = document.getElementById('pitchLine');
      const b1 = document.getElementById('btnPitch1');
      const b2 = document.getElementById('btnPitch2');
      const b3 = document.getElementById('btnPitch3');
      const activeCls = "px-2.5 py-1 rounded-full bg-sky-600 text-white font-extrabold text-[10px] shadow-sm transition";
      const idleCls = "px-2.5 py-1 rounded-full bg-white hover:bg-sky-50 text-slate-700 border border-slate-200 font-semibold text-[10px] transition";

      if (b1) b1.className = mode === 'parcelado' ? activeCls : idleCls;
      if (b2) b2.className = mode === 'garantia' ? activeCls : idleCls;
      if (b3) b3.className = mode === 'mvp' ? activeCls : idleCls;

      if (mode === 'parcelado') {
        pitch.innerHTML = `"Compreendo perfeitamente! A diferença é que um site barato demora 7 segundos para abrir e faz você perder clientes todo dia. Se o nosso site salvar <strong class="text-slate-900">apenas UMA venda</strong> neste mês, ele já se pagou 5 vezes. Vamos fechar em <strong class="text-slate-900">3x de R$ 1.500 sem juros</strong> para colocar no ar já na próxima semana?"`;
      } else if (mode === 'garantia') {
        pitch.innerHTML = `"Colocamos em contrato a garantia de <strong class="text-slate-900">nota acima de 95 no Google PageSpeed</strong>. Seu site vai abrir em menos de 1 segundo no 4G de qualquer cliente."`;
      } else if (mode === 'mvp') {
        pitch.innerHTML = `"Se preferir começar mais enxuto, lançamos a <strong class="text-slate-900">Versão Essencial + Botão WhatsApp por R$ 3.200</strong> em 7 dias úteis!"`;
      }
    }

    function applyAiSuggestionToCall() {
      const pitchText = document.getElementById('pitchLine').innerText;
      const box = document.getElementById('transcriptBox');
      box.innerHTML += `
        <div class="flex flex-col items-end">
          <span class="text-[10px] font-bold text-slate-500 mb-1">Operador (Sua Equipe)</span>
          <div class="max-w-[84%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-[#e6f0ff] border border-sky-200/90 text-slate-800 font-medium leading-relaxed shadow-sm">
            ${pitchText}
          </div>
          <span class="text-[9px] text-slate-400 mt-1 font-mono">Agora</span>
        </div>
      `;
      box.scrollTop = box.scrollHeight;
      updateTelemetry(78, 'RECUPERANDO • POSITIVO', '#0284c7', 'rgba(2, 132, 199, 0.12)', 'Sugestão IA');
    }

    function simulateEvent(type) {
      if (type === 'objection_price') {
        document.getElementById('customSpeechInput').value = "Olha, achei o valor muito caro, acima de R$ 3.000 não consigo pagar.";
      } else if (type === 'objection_time') {
        document.getElementById('customSpeechInput').value = "Vou pensar com meu sócio e semana que vem te dou um retorno.";
      } else if (type === 'positive_close') {
        document.getElementById('customSpeechInput').value = "Gostei da proposta parcelada em 3x! Vamos fechar, pode mandar o contrato.";
      }
      analyzeCustomCustomerSpeech();
    }

    function updateTelemetry(score, label, colorHex, bgRgba, chartLabel) {
      const num = document.getElementById('probNumber');
      const miniBadge = document.getElementById('miniProbBadge');
      const status = document.getElementById('probStatus');
      const ring = document.getElementById('probRingCircle');
      const score3d = document.getElementById('live3DScoreCurrent');
      const trendBadge = document.getElementById('sentimentTrendBadge');
      const waveDot = document.getElementById('waveLiveDot');
      const waveHalo = document.getElementById('waveLiveHalo');
      const wavePath = document.getElementById('sentimentWavePath');
      const waveArea = document.getElementById('sentimentWaveArea');

      if (num) num.innerText = score + '%';
      if (miniBadge) miniBadge.innerText = score + '%';
      if (status) status.innerText = label.toUpperCase();

      // Atualiza o anel SVG (circunferência = 201)
      if (ring) {
        const circumference = 201;
        const offset = Math.round(circumference - (score / 100) * circumference);
        ring.setAttribute('stroke-dashoffset', offset);
      }

      // Atualiza o ponto final da curva SVG (y entre 18 e 95)
      const endY = Math.max(18, Math.min(95, Math.round(110 - (score / 100) * 90)));
      if (waveDot) waveDot.setAttribute('cy', endY);
      if (waveHalo) waveHalo.setAttribute('cy', endY);
      if (wavePath) {
        wavePath.setAttribute('d', `M 10,85 C 45,55 65,40 90,40 C 125,40 145,75 170,78 C 195,82 220,96 245,86 C 270,74 290,45 305,${endY}`);
      }
      if (waveArea) {
        waveArea.setAttribute('d', `M 10,85 C 45,55 65,40 90,40 C 125,40 145,75 170,78 C 195,82 220,96 245,86 C 270,74 290,45 305,${endY} L 305,105 L 10,105 Z`);
      }

      if (score < 45) {
        if (num) num.className = "absolute text-sm font-extrabold text-rose-600";
        if (status) status.className = "inline-block mt-1 px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase bg-rose-500/15 text-rose-800 border border-rose-500/30";
        if (score3d) score3d.innerText = `${score}% Risco`;
        if (trendBadge) {
          trendBadge.className = "text-[9px] text-rose-800 font-extrabold flex items-center gap-1 bg-rose-500/15 px-2 py-0.5 rounded-full border border-rose-500/30";
          trendBadge.innerHTML = `<i class="fa-solid fa-arrow-trend-down text-[8px]"></i> Em Queda`;
        }
      } else if (score < 75) {
        if (num) num.className = "absolute text-sm font-extrabold text-[#0e1014]";
        if (status) status.className = "inline-block mt-1 px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase bg-amber-500/15 text-amber-900 border border-amber-500/30";
        if (score3d) score3d.innerText = `${score}% Atenção`;
        if (trendBadge) {
          trendBadge.className = "text-[9px] text-amber-900 font-extrabold flex items-center gap-1 bg-amber-500/15 px-2 py-0.5 rounded-full border border-amber-500/30";
          trendBadge.innerHTML = `<i class="fa-solid fa-scale-balanced text-[8px]"></i> Negociando`;
        }
      } else {
        if (num) num.className = "absolute text-sm font-extrabold text-emerald-700";
        if (status) status.className = "inline-block mt-1 px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase bg-emerald-500/15 text-emerald-800 border border-emerald-500/30";
        if (score3d) score3d.innerText = `${score}% Positivo`;
        if (trendBadge) {
          trendBadge.className = "text-[9px] text-emerald-800 font-extrabold flex items-center gap-1 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/30";
          trendBadge.innerHTML = `<i class="fa-solid fa-arrow-trend-up text-[8px]"></i> Recuperando`;
        }
      }
    }

    function openNewTicketModal() {
      document.getElementById('newTicketModal').classList.remove('hidden');
    }

    function closeNewTicketModal() {
      document.getElementById('newTicketModal').classList.add('hidden');
    }

    function handleCreateTicket(e) {
      e.preventDefault();
      const btn = document.getElementById('btnCreateTicket');
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> IA Analisando Perfil...`;

      const name = document.getElementById('ticketName').value;
      const phone = document.getElementById('ticketPhone') ? document.getElementById('ticketPhone').value : "5511987654321";
      const company = document.getElementById('ticketCompany').value;
      const link = document.getElementById('ticketLink').value || "Sem link informado";
      const bio = document.getElementById('ticketBio').value || "Cliente procurando orçamento rápido.";

      setTimeout(() => {
        const painText = `${bio} — Diagnóstico Gemini: O cliente necessita de site rápido com captação direta no WhatsApp e versão mobile otimizada.`;

        const cardsContainer = document.getElementById('colCards-1');
        const newCard = document.createElement('div');
        newCard.className = "pipefy-card rounded-xl p-3.5 cursor-pointer border-l-4 border-l-emerald-400";
        newCard.onclick = () => openClientAttendance(name, company, phone, link, 'Mapeado via IA', painText);
        newCard.innerHTML = `
          <div class="flex justify-between items-start mb-2">
            <span class="text-[10px] font-extrabold uppercase bg-emerald-400/15 text-emerald-300 px-2 py-0.5 rounded border border-emerald-400/30">${company}</span>
            <span class="text-[10px] text-emerald-400 font-bold">Novo</span>
          </div>
          <h4 class="font-bold text-xs text-white">${name} — Criação de Site</h4>
          <p class="text-[11px] text-slate-400 mt-1 line-clamp-2">${bio}</p>
          <div class="mt-3 pt-2.5 border-t border-white/10 flex justify-between items-center text-[11px]">
            <span class="text-slate-400 truncate max-w-[120px]">${link}</span>
            <span class="bg-gradient-to-r from-white via-slate-100 to-slate-200 hover:from-white hover:to-white text-[#0e1014] px-2.5 py-1 rounded-lg font-extrabold text-[10px] shadow-sm">
              <i class="fa-solid fa-headset mr-1"></i> Fazer Atendimento &rarr;
            </span>
          </div>
        `;
        cardsContainer.prepend(newCard);

        btn.innerHTML = `<i class="fa-solid fa-sparkles"></i> Analisar com IA & Adicionar ao Kanban`;
        closeNewTicketModal();
        goToView('kanban');
      }, 600);
    }

    window.onload = function() {
      const statusTxt = document.getElementById('apiStatusText');
      if (localStorage.getItem('APEX_GEMINI_KEY') && statusTxt) {
        statusTxt.innerText = 'Ativa';
        statusTxt.className = 'text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-extrabold';
      }

      // Validação de retorno de link de e-mail verificado
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('verified') === '1') {
        const verifiedEmail = urlParams.get('email') || '';
        showAlrisToast(
          'E-mail Corporativo Confirmado!',
          `Seu e-mail ${verifiedEmail ? `<strong class="text-white">${verifiedEmail}</strong> ` : ''}foi validado com sucesso. Faça login para acessar o painel.`
        );
        goToView('login');
        if (verifiedEmail && document.getElementById('loginEmail')) {
          document.getElementById('loginEmail').value = verifiedEmail;
        }
      }
    };
