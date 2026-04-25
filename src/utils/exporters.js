import { formatScore, getRoundPenalty, getRoundPenaltyTotals, PLAYER_LABEL, ROUND_TYPE_LABEL } from './game.js';

export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const downloadText = (text, filename, type = 'text/plain') => {
  downloadBlob(new Blob([text], { type }), filename);
};

export const renderElementPngBlob = async (element) => {
  const { default: html2canvas } = await import('html2canvas');
  await document.fonts?.ready;

  const canvas = await html2canvas(element, {
    backgroundColor: '#050306',
    scale: Math.min(2, window.devicePixelRatio || 1.5),
    useCORS: true,
    logging: false,
  });

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1));
  if (!blob) throw new Error('Could not create PNG.');
  return blob;
};

export const copyOrDownloadPng = async ({ element, filename, notice }) => {
  const blob = await renderElementPngBlob(element);
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      notice?.('Copied PNG to clipboard.');
      return 'copied';
    } catch (error) {
      console.warn('Clipboard image copy failed, downloading instead.', error);
    }
  }

  downloadBlob(blob, filename);
  notice?.('Clipboard unavailable, downloaded PNG instead.');
  return 'downloaded';
};

export const downloadElementPng = async ({ element, filename }) => {
  const blob = await renderElementPngBlob(element);
  downloadBlob(blob, filename);
};

export const shareElementImage = async ({ element, filename, title, text }) => {
  if (!element) throw new Error('Nothing to share yet.');
  if (!navigator.share) {
    throw new Error('Open this in Safari or Chrome on your phone to share the scoreboard into WhatsApp.');
  }

  const blob = await renderElementPngBlob(element);
  const file = new File([blob], filename, {
    type: 'image/png',
    lastModified: Date.now(),
  });

  if (navigator.canShare && !navigator.canShare({ files: [file] })) {
    throw new Error('This browser can share text, but not image files. Use Safari or Chrome on your phone for WhatsApp sharing.');
  }

  await navigator.share({
    title,
    text,
    files: [file],
  });

  return file;
};

const drawCenteredText = (ctx, text, x, y, maxWidth, lineHeight) => {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let active = '';

  words.forEach((word) => {
    const test = active ? `${active} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !active) {
      active = test;
    } else {
      lines.push(active);
      active = word;
    }
  });
  if (active) lines.push(active);

  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.slice(0, 5).forEach((line, index) => {
    ctx.fillText(line, x, startY + index * lineHeight);
  });
};

const drawRevealFrame = (ctx, round, progress) => {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const scene = Math.min(3, Math.floor(progress * 4));
  const localProgress = (progress * 4) % 1;

  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#050306');
  gradient.addColorStop(0.48, '#180713');
  gradient.addColorStop(1, '#050306');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#ff3158';
  ctx.lineWidth = 4;
  ctx.strokeRect(34, 34, width - 68, height - 68);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 2;
  ctx.strokeRect(54, 54, width - 108, height - 108);

  ctx.fillStyle = '#f15bb5';
  ctx.font = '800 28px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`KJK KIMJAYKINKS / Round ${round.number} / ${ROUND_TYPE_LABEL[round.roundType] || round.roundType}`, width / 2, 92);

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 52px Inter, sans-serif';
  drawCenteredText(ctx, round.question, width / 2, 190, width - 210, 62);

  if (scene >= 1) {
    const reveal = scene === 1 ? localProgress : 1;
    const cardWidth = 390;
    const cardY = 340;
    const leftX = width / 2 - cardWidth - 28;
    const rightX = width / 2 + 28;
    const alpha = Math.min(1, reveal * 1.4);
    ctx.globalAlpha = alpha;

    [
      { name: 'Jay', score: getRoundPenalty(round, 'jay'), total: getRoundPenaltyTotals(round).jay, x: leftX },
      { name: 'Kim', score: getRoundPenalty(round, 'kim'), total: getRoundPenaltyTotals(round).kim, x: rightX },
    ].forEach((player) => {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(player.x, cardY, cardWidth, 154);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.strokeRect(player.x, cardY, cardWidth, 154);
      ctx.fillStyle = '#fee440';
      ctx.font = '900 32px Inter, sans-serif';
      ctx.fillText(player.name, player.x + cardWidth / 2, cardY + 46);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 66px Menlo, monospace';
      ctx.fillText(formatScore(player.score), player.x + cardWidth / 2, cardY + 122);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '900 18px Inter, sans-serif';
      ctx.fillText('Penalty Added', player.x + cardWidth / 2, cardY + 148);
    });
    ctx.globalAlpha = 1;
  }

  if (scene >= 2) {
    const totalReveal = scene === 2 ? localProgress : 1;
    ctx.fillStyle = '#00f5d4';
    ctx.font = '900 34px Inter, sans-serif';
    ctx.fillText('Updated Total Penalties', width / 2, 548);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 46px Menlo, monospace';
    const jayTotal = getRoundPenaltyTotals(round).jay * totalReveal;
    const kimTotal = getRoundPenaltyTotals(round).kim * totalReveal;
    ctx.fillText(`Jay ${formatScore(jayTotal)}   /   Kim ${formatScore(kimTotal)}`, width / 2, 610);
  }

  if (scene >= 3) {
    ctx.fillStyle = '#ffd166';
    ctx.font = '900 30px Inter, sans-serif';
    ctx.fillText(
      `Lower this round: ${PLAYER_LABEL[round.winner]} / Lowest total: ${PLAYER_LABEL[round.overallLeader]}`,
      width / 2,
      670,
    );
  }
};

export const exportRoundWebm = async (round) => {
  if (!round) throw new Error('Choose a round to export first.');
  if (!HTMLCanvasElement.prototype.captureStream || !window.MediaRecorder) {
    throw new Error('This browser does not support client-side WebM export.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(30);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  const finished = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
  });

  recorder.start();
  const duration = 5200;
  const startedAt = performance.now();

  await new Promise((resolve) => {
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      drawRevealFrame(ctx, round, Math.min(1, elapsed / duration));
      if (elapsed < duration) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    tick();
  });

  recorder.stop();
  const blob = await finished;
  downloadBlob(blob, `kjk-kimjaykinks-round-${round.number}-reveal.webm`);
};
