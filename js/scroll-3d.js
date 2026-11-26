const TOTAL_3D_FRAMES = 144;
    const START_3D_FRAME = 4; // Frame 004: coluna central totalmente apagada (sem luz) no novo vídeo capa_4.mp4
    const FRAME_CACHE_VER = 'capa4_v1';
    const preloadedImages = new Map();
    let targetFrameFloat = 0;
    let currentFrameFloat = 0;
    let lastDrawnSeqIndex = -1;
    let isAnimatingFrames = false;
    let lastScrollTopValue = 0;

    // Estado dedicado para o LED interativo da Página de Login guiado pela seta do mouse
    let loginTargetFrameFloat = 0;
    let loginCurrentFrameFloat = 0;
    let lastDrawnLoginSeqIndex = -1;
    let isAnimatingLoginFrames = false;

    // Estado dedicado para o vídeo em frames do Ambiente Logado (Kanban + Novo Chamado + Atendimento)
    const TOTAL_WORKSPACE_FRAMES = 240;
    const WORKSPACE_FRAME_VER = 'kanban1_v1';
    const workspacePreloadedImages = new Map();
    let workspaceTargetFrameFloat = 0;
    let workspaceCurrentFrameFloat = 0;
    let lastDrawnWorkspaceIndex = -1;
    let isAnimatingWorkspaceFrames = false;

    const activeFrameSequence = [];
    for (let i = START_3D_FRAME; i < TOTAL_3D_FRAMES; i++) activeFrameSequence.push(i);

    function drawFrameOnCanvas(seqIndex) {
      const canvas = document.getElementById('fullScreenFrameCanvas');
      if (!canvas) return;
      const frameNum = activeFrameSequence[seqIndex];
      const img = preloadedImages.get(frameNum);
      if (img && img.complete && img.naturalWidth > 0) {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          lastDrawnSeqIndex = seqIndex;
        }
      }
    }

    function drawLoginFrameOnCanvas(seqIndex) {
      const canvas = document.getElementById('loginBgFrameCanvas');
      if (!canvas) return;
      const frameNum = activeFrameSequence[seqIndex];
      const img = preloadedImages.get(frameNum);
      if (img && img.complete && img.naturalWidth > 0) {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          lastDrawnLoginSeqIndex = seqIndex;
        }
      }
    }

    function preloadAll3DFrames() {
      // Carrega primeiro o frame 004 imediato para exibir sem atraso na Home e no Login
      const firstNum = String(START_3D_FRAME).padStart(3, '0');
      const firstImg = new Image();
      firstImg.onload = () => {
        if (lastDrawnSeqIndex === -1) drawFrameOnCanvas(0);
        if (lastDrawnLoginSeqIndex === -1) drawLoginFrameOnCanvas(0);
      };
      firstImg.src = `assets/frames/frame_${firstNum}.jpg?v=${FRAME_CACHE_VER}`;
      preloadedImages.set(START_3D_FRAME, firstImg);

      // Pré-carrega os demais frames em segundo plano
      activeFrameSequence.slice(1).forEach(idx => {
        const img = new Image();
        const num = String(idx).padStart(3, '0');
        img.src = `assets/frames/frame_${num}.jpg?v=${FRAME_CACHE_VER}`;
        preloadedImages.set(idx, img);
      });
    }

    function tickSmooth3DFrames() {
      const diff = targetFrameFloat - currentFrameFloat;
      if (Math.abs(diff) > 0.05) {
        currentFrameFloat += diff * 0.16;
      } else {
        currentFrameFloat = targetFrameFloat;
      }

      const seqIndex = Math.max(0, Math.min(activeFrameSequence.length - 1, Math.round(currentFrameFloat)));
      if (seqIndex !== lastDrawnSeqIndex) {
        drawFrameOnCanvas(seqIndex);
      }

      if (Math.abs(targetFrameFloat - currentFrameFloat) > 0.05) {
        requestAnimationFrame(tickSmooth3DFrames);
      } else {
        isAnimatingFrames = false;
      }
    }

    function tickSmoothLogin3DFrames() {
      const diff = loginTargetFrameFloat - loginCurrentFrameFloat;
      if (Math.abs(diff) > 0.05) {
        loginCurrentFrameFloat += diff * 0.14;
      } else {
        loginCurrentFrameFloat = loginTargetFrameFloat;
      }

      const seqIndex = Math.max(0, Math.min(activeFrameSequence.length - 1, Math.round(loginCurrentFrameFloat)));
      if (seqIndex !== lastDrawnLoginSeqIndex) {
        drawLoginFrameOnCanvas(seqIndex);
      }

      if (Math.abs(loginTargetFrameFloat - loginCurrentFrameFloat) > 0.05) {
        requestAnimationFrame(tickSmoothLogin3DFrames);
      } else {
        isAnimatingLoginFrames = false;
      }
    }

    // Na página de login: quando a seta do mouse está baixa (abaixo do card), a luz fica apagada (frame 004).
    // Conforme sobe a seta do mouse, a luz de LED da coluna central sobe e acompanha a altura da seta!
    function handleLoginMouseMove3D(e) {
      const vh = Math.max(1, window.innerHeight);
      const clientY = e.clientY;
      // Na faixa inferior da tela (abaixo de 82% da altura), fica totalmente apagado (0)
      // Conforme sobe a seta até o topo (12% da altura), o progresso vai de 0 até 1 (100% aceso no teto)
      const bottomThreshold = vh * 0.84;
      const topThreshold = vh * 0.10;
      const rawUpProgress = (bottomThreshold - clientY) / Math.max(1, bottomThreshold - topThreshold);
      const clampedProgress = Math.max(0, Math.min(1, rawUpProgress));

      const totalSeq = activeFrameSequence.length;
      if (clampedProgress <= 0.02) {
        loginTargetFrameFloat = 0; // Totalmente apagado quando a seta está embaixo
      } else {
        loginTargetFrameFloat = clampedProgress * (totalSeq - 1);
      }

      if (!isAnimatingLoginFrames) {
        isAnimatingLoginFrames = true;
        requestAnimationFrame(tickSmoothLogin3DFrames);
      }

      const loginBadge = document.getElementById('loginFrameCounterBadge');
      if (loginBadge) {
        const pct = Math.round(clampedProgress * 100);
        loginBadge.innerText = pct <= 2
          ? 'LED APAGADO • SUBA A SETA DO MOUSE PARA ACENDER'
          : `LED ${pct}% ACESO • ACOMPANHANDO A SETA DO MOUSE`;
      }
    }

    function handleFullScreenFrameScroll(container) {
      const badge = document.getElementById('frameCounterBadge');
      const planosSection = document.getElementById('planos');
      const header = document.getElementById('mainHeader');
      if (!container || !planosSection) return;

      const scrollTop = container.scrollTop;
      const isScrollingUp = scrollTop < lastScrollTopValue - 4;
      const isScrollingDown = scrollTop > lastScrollTopValue + 4;

      if (header) {
        if (scrollTop <= 80) {
          header.style.transform = 'translateY(0)';
          header.style.opacity = '1';
          header.style.pointerEvents = 'auto';
        } else if (isScrollingDown && scrollTop > 120) {
          header.style.transform = 'translateY(-110%)';
          header.style.opacity = '0';
          header.style.pointerEvents = 'none';
        } else if (isScrollingUp) {
          header.style.transform = 'translateY(0)';
          header.style.opacity = '1';
          header.style.pointerEvents = 'auto';
        }
      }
      lastScrollTopValue = scrollTop;

      const maxScroll = Math.max(1, planosSection.offsetTop - window.innerHeight * 0.85);
      const rawProgress = Math.max(0, Math.min(1, scrollTop / maxScroll));

      const totalSeq = activeFrameSequence.length;
      if (scrollTop <= 1) {
        targetFrameFloat = 0;
      } else {
        const eased = Math.pow(rawProgress, 0.85);
        targetFrameFloat = Math.max(1.5, eased * (totalSeq - 1));
      }

      if (!isAnimatingFrames) {
        isAnimatingFrames = true;
        requestAnimationFrame(tickSmooth3DFrames);
      }

      if (badge) {
        const displayFrame = String(activeFrameSequence[Math.round(targetFrameFloat)] || START_3D_FRAME).padStart(3, '0');
        badge.innerText = `FRAME ${displayFrame} / 143 • ${Math.round(rawProgress * 100)}%`;
      }
    }

    function drawWorkspaceFrameOnCanvas(frameIndex) {
      const canvas = document.getElementById('workspaceBgFrameCanvas');
      if (!canvas) return;
      const clampedIdx = Math.max(0, Math.min(TOTAL_WORKSPACE_FRAMES - 1, frameIndex));
      const img = workspacePreloadedImages.get(clampedIdx);
      if (img && img.complete && img.naturalWidth > 0) {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          lastDrawnWorkspaceIndex = clampedIdx;
        }
      }
    }

    function preloadWorkspaceFrames() {
      const firstImg = new Image();
      firstImg.onload = () => {
        if (lastDrawnWorkspaceIndex === -1) drawWorkspaceFrameOnCanvas(0);
      };
      firstImg.src = `assets/kanban-frames/frame_000.jpg?v=${WORKSPACE_FRAME_VER}`;
      workspacePreloadedImages.set(0, firstImg);

      // Pré-carrega os demais 239 frames da central em lotes suaves
      let i = 1;
      function loadBatch() {
        const end = Math.min(TOTAL_WORKSPACE_FRAMES, i + 24);
        for (; i < end; i++) {
          const img = new Image();
          const num = String(i).padStart(3, '0');
          img.src = `assets/kanban-frames/frame_${num}.jpg?v=${WORKSPACE_FRAME_VER}`;
          workspacePreloadedImages.set(i, img);
        }
        if (i < TOTAL_WORKSPACE_FRAMES) {
          setTimeout(loadBatch, 40);
        }
      }
      setTimeout(loadBatch, 100);
    }

    function tickSmoothWorkspace3DFrames() {
      const diff = workspaceTargetFrameFloat - workspaceCurrentFrameFloat;
      if (Math.abs(diff) > 0.05) {
        workspaceCurrentFrameFloat += diff * 0.12;
      } else {
        workspaceCurrentFrameFloat = workspaceTargetFrameFloat;
      }

      const idx = Math.max(0, Math.min(TOTAL_WORKSPACE_FRAMES - 1, Math.round(workspaceCurrentFrameFloat)));
      if (idx !== lastDrawnWorkspaceIndex) {
        drawWorkspaceFrameOnCanvas(idx);
      }

      if (Math.abs(workspaceTargetFrameFloat - workspaceCurrentFrameFloat) > 0.05) {
        requestAnimationFrame(tickSmoothWorkspace3DFrames);
      } else {
        isAnimatingWorkspaceFrames = false;
      }
    }

    function handleWorkspaceMouseMove3D(e) {
      const shell = document.getElementById('workspace-shell');
      if (!shell || shell.classList.contains('hidden')) return;

      const vw = Math.max(1, window.innerWidth);
      const vh = Math.max(1, window.innerHeight);
      const progressX = Math.max(0, Math.min(1, e.clientX / vw));
      const progressY = Math.max(0, Math.min(1, e.clientY / vh));
      // Combina deslocamento horizontal e vertical do mouse para avançar/voltar suavemente pelos 240 frames
      const combinedProgress = Math.max(0, Math.min(1, progressX * 0.72 + progressY * 0.28));
      workspaceTargetFrameFloat = combinedProgress * (TOTAL_WORKSPACE_FRAMES - 1);

      if (!isAnimatingWorkspaceFrames) {
        isAnimatingWorkspaceFrames = true;
        requestAnimationFrame(tickSmoothWorkspace3DFrames);
      }
    }

    window.addEventListener('mousemove', handleWorkspaceMouseMove3D, { passive: true });

    // Inicia o pré-carregamento imediato
    preloadAll3DFrames();
    preloadWorkspaceFrames();
