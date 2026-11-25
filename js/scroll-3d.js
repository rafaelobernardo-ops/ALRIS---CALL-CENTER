const TOTAL_3D_FRAMES = 144;
    const START_3D_FRAME = 16; // Frame 016: coluna central totalmente apagada (sem luz)
    const FRAME_CACHE_VER = 'capa5';
    const preloadedImages = new Map();
    let targetFrameFloat = 0;
    let currentFrameFloat = 0;
    let lastDrawnSeqIndex = -1;
    let isAnimatingFrames = false;

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
      // Carrega primeiro o frame 016 imediato para exibir sem atraso
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

      // Minimizar cabeçalho suavemente no scroll
      if (header) {
        if (scrollTop > 40) {
          header.classList.remove('py-4', 'bg-[#0a0d14]/40');
          header.classList.add('py-1.5', 'bg-[#07090e]/80', 'backdrop-blur-xl', 'shadow-md');
          header.querySelector('.group > div')?.classList.add('scale-90');
        } else {
          header.classList.add('py-4', 'bg-[#0a0d14]/40');
          header.classList.remove('py-1.5', 'bg-[#07090e]/80', 'backdrop-blur-xl', 'shadow-md');
          header.querySelector('.group > div')?.classList.remove('scale-90');
        }
      }
      const maxScroll = Math.max(1, planosSection.offsetTop - window.innerHeight * 0.85);
      const rawProgress = Math.max(0, Math.min(1, scrollTop / maxScroll));

      // No topo absoluto (scrollTop === 0) fica no frame 016 (sem luz).
      // No primeiro movimento do scroll, já entra suavemente nos quadros em que a luz começa a acender.
      const totalSeq = activeFrameSequence.length;
      if (scrollTop <= 1) {
        targetFrameFloat = 0;
      } else {
        const eased = Math.pow(rawProgress, 0.85);
        targetFrameFloat = Math.max(2, eased * (totalSeq - 1));
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
