const TOTAL_3D_FRAMES = 144;
    const START_3D_FRAME = 4; // Frame 004: coluna central totalmente apagada (sem luz) no novo vídeo capa_4.mp4
    const FRAME_CACHE_VER = 'capa4_v1';
    const preloadedImages = new Map();
    let targetFrameFloat = 0;
    let currentFrameFloat = 0;
    let lastDrawnSeqIndex = -1;
    let isAnimatingFrames = false;
    let lastScrollTopValue = 0;

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

    function preloadAll3DFrames() {
      // Carrega primeiro o frame 004 imediato para exibir sem atraso
      const firstNum = String(START_3D_FRAME).padStart(3, '0');
      const firstImg = new Image();
      firstImg.onload = () => {
        if (lastDrawnSeqIndex === -1) drawFrameOnCanvas(0);
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
        // Interpolação suave (lerp) a 60fps para eliminar qualquer sensação de peso no scroll
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

    function handleFullScreenFrameScroll(container) {
      const badge = document.getElementById('frameCounterBadge');
      const planosSection = document.getElementById('planos');
      const header = document.getElementById('mainHeader');
      if (!container || !planosSection) return;

      const scrollTop = container.scrollTop;
      const isScrollingUp = scrollTop < lastScrollTopValue - 4;
      const isScrollingDown = scrollTop > lastScrollTopValue + 4;

      // Assim que rolar o scroll e a seção inicial de atendimento começar a sair, o cabeçalho sobe e desaparece.
      // Só volta a aparecer quando subir o scroll ou retornar ao topo.
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

      // No topo absoluto (scrollTop === 0) fica no frame 004 (sem luz).
      // No primeiro movimento do scroll, já entra suavemente no frame 005 onde o LED branco acende na base.
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

    // Inicia o pré-carregamento imediato
    preloadAll3DFrames();
