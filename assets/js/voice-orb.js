// Wide, mirrored session waveform for the Meeting modal and mini player.
// Canvas 2D is used deliberately: the design is made of several soft,
// overlapping lobes like the supplied reference, rather than a round orb.

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (from, to, amount) => from + (to - from) * amount;

// The public name stays VoiceEngine because voice-orb-init.js already imports
// it. Requests real microphone access via getUserMedia + an AnalyserNode -
// only the first time a session actually starts recording (see setMeetPaused
// in script.js), not just from opening the Meeting screen. Audio is never
// recorded/stored anywhere, only sampled live for the visual - matches the
// "no server, no hard drives" architecture this project's mic feature was
// scoped to. Falls back to the old procedural motion if permission is
// denied or no mic is available, so the orb still animates either way.
const VoiceEngine = {
  active: false,
  usingMic: false,
  _stream: null,
  _audioCtx: null,
  _analyser: null,
  _data: null,

  async start() {
    if (this.active) return true;
    this.active = true;
    if (this.usingMic) return true; // already set up from a prior start()

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this._audioCtx = new AudioCtx();
      const source = this._audioCtx.createMediaStreamSource(this._stream);
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 256;
      this._analyser.smoothingTimeConstant = 0.6;
      source.connect(this._analyser);
      this._data = new Uint8Array(this._analyser.frequencyBinCount);
      this.usingMic = true;
    } catch (err) {
      // No mic, permission denied, or an insecure (non-https/localhost)
      // context - the orb still needs to move, just without real input.
      console.warn('Mic unavailable, falling back to procedural motion:', err);
      this.usingMic = false;
    }
    return true;
  },

  stop() {
    this.active = false;
    this._stream?.getTracks().forEach((track) => track.stop());
    this._audioCtx?.close();
    this._stream = null;
    this._audioCtx = null;
    this._analyser = null;
    this._data = null;
    this.usingMic = false;
  },

  sample() {
    if (!this.active) {
      return { level: 0, bass: 0, mid: 0, high: 0 };
    }

    if (this.usingMic && this._analyser && this._data) {
      this._analyser.getByteFrequencyData(this._data);
      const bins = this._data.length;
      const third = Math.floor(bins / 3);
      const bandAverage = (start, end) => {
        let sum = 0;
        for (let i = start; i < end; i += 1) sum += this._data[i];
        return sum / (end - start) / 255;
      };
      const bass = bandAverage(0, third);
      const mid = bandAverage(third, third * 2);
      const high = bandAverage(third * 2, bins);
      return { level: (bass + mid + high) / 3, bass, mid, high };
    }

    const time = performance.now() * 0.001;
    return {
      level: 0.58 + Math.sin(time * 1.2) * 0.17 + Math.sin(time * 2.35 + 1.4) * 0.08,
      bass: 0.68 + Math.sin(time * 0.9 + 0.4) * 0.22,
      mid: 0.62 + Math.sin(time * 1.65 + 2.1) * 0.22,
      high: 0.48 + Math.sin(time * 2.8 + 4.2) * 0.18,
    };
  },
};

/**
 * Mount an animated, transparent voice waveform into a container.
 * Returns the same small API used by script.js: setPaused, resize, destroy.
 */
export function createVoiceOrb(container, { voiceSensitivity = 1.5 } = {}) {
  if (!container) return { setPaused() {}, resize() {}, destroy() {} };

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return { setPaused() {}, resize() {}, destroy() {} };

  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.setAttribute('aria-hidden', 'true');
  container.replaceChildren(canvas);

  const compact = container.id.includes('mini');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let paused = true;
  let animationFrame = null;
  let frozenTime = 0;
  let previousTimestamp = 0;
  let visual = { level: 0, bass: 0, mid: 0, high: 0 };

  function resize() {
    const bounds = container.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    width = bounds.width;
    height = bounds.height;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function gaussian(x, center, spread) {
    return Math.exp(-Math.pow((x - center) / spread, 2));
  }

  function envelope(x, time, phase = 0) {
    const edgeTaper = Math.pow(Math.sin(Math.PI * clamp(x)), 0.72);
    const centralPair =
      gaussian(x, 0.38, 0.082) * 1.22 +
      gaussian(x, 0.62, 0.082) * 1.22;
    const sidePair =
      gaussian(x, 0.22, 0.058) * 0.76 +
      gaussian(x, 0.78, 0.058) * 0.76;
    const shoulders =
      gaussian(x, 0.105, 0.06) * 0.31 +
      gaussian(x, 0.895, 0.06) * 0.31;
    const contour = centralPair + sidePair + shoulders + 0.025;

    const voiceTexture =
      Math.sin(x * 15.5 + time * 1.85 + phase) * visual.mid * 0.22 +
      Math.sin(x * 29.0 - time * 3.1 - phase) * visual.high * 0.13 +
      Math.sin(x * 8.0 - time * 1.35) * visual.bass * 0.16;

    return Math.max(0, edgeTaper * (contour + voiceTexture));
  }

  function createWavePath(time, scale = 1, phase = 0) {
    const samples = Math.max(90, Math.floor(width / (compact ? 3 : 5)));
    const padding = compact ? 3 : Math.max(8, width * 0.018);
    const availableWidth = width - padding * 2;
    const centerY = height * 0.5;
    const maxAmplitude = height * (compact ? 0.43 : 0.455);
    const blurPadding = compact ? 10 : Math.min(34, height * 0.16);
    const amplitudeLimit = Math.max(8, height * 0.5 - blurPadding);
    const drive = paused ? 0.56 : 0.5 + visual.level * 0.72;

    // The colored layers use a large blur. Softly compress only the tallest
    // peaks so the glow has room to fade before reaching the canvas edge.
    const fitAmplitude = (rawAmplitude) =>
      amplitudeLimit * Math.tanh(rawAmplitude / amplitudeLimit);

    context.beginPath();
    for (let index = 0; index <= samples; index += 1) {
      const position = index / samples;
      const x = padding + position * availableWidth;
      const amplitude = fitAmplitude(envelope(position, time, phase) * maxAmplitude * drive * scale);
      const y = centerY - amplitude;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }

    for (let index = samples; index >= 0; index -= 1) {
      const position = index / samples;
      const x = padding + position * availableWidth;
      const amplitude = fitAmplitude(envelope(position, time, phase) * maxAmplitude * drive * scale);
      const undersideMotion = paused
        ? 0
        : Math.sin(position * 21 - time * 1.7) * maxAmplitude * visual.high * 0.025;
      context.lineTo(x, centerY + amplitude + undersideMotion);
    }
    context.closePath();
  }

  function horizontalGradient(colors) {
    const gradient = context.createLinearGradient(0, 0, width, 0);
    colors.forEach(([stop, color]) => gradient.addColorStop(stop, color));
    return gradient;
  }

  function draw(time) {
    if (!width || !height) return;
    context.clearRect(0, 0, width, height);

    const blurScale = compact ? 0.55 : 1;
    const voiceGlow = visual.level * 8 * blurScale;
    const centerY = height * 0.5;

    // Blue outer silhouette gives the same cool, dusty edge as the reference.
    context.save();
    context.filter = `blur(${(13 * blurScale + voiceGlow).toFixed(1)}px)`;
    createWavePath(time, 1.08, -0.45);
    context.fillStyle = horizontalGradient([
      [0, 'rgba(26, 61, 131, 0.06)'],
      [0.10, 'rgba(25, 60, 131, 0.54)'],
      [0.25, 'rgba(32, 68, 143, 0.66)'],
      [0.46, 'rgba(21, 54, 124, 0.62)'],
      [0.54, 'rgba(21, 54, 124, 0.62)'],
      [0.75, 'rgba(32, 68, 143, 0.66)'],
      [0.90, 'rgba(25, 60, 131, 0.54)'],
      [1, 'rgba(26, 61, 131, 0.06)'],
    ]);
    context.fill();
    context.restore();

    // Warm inner body. Screen blending makes it luminous on the tan card.
    context.save();
    context.globalCompositeOperation = 'screen';
    context.filter = `blur(${(7 * blurScale + visual.level * 5).toFixed(1)}px)`;
    createWavePath(time, 0.62 + visual.mid * 0.08, 0.75);
    context.fillStyle = horizontalGradient([
      [0, 'rgba(255, 119, 48, 0.02)'],
      [0.13, 'rgba(242, 91, 39, 0.28)'],
      [0.24, 'rgba(255, 103, 40, 0.78)'],
      [0.40, 'rgba(255, 93, 34, 0.88)'],
      [0.50, 'rgba(255, 123, 49, 0.74)'],
      [0.60, 'rgba(255, 93, 34, 0.88)'],
      [0.76, 'rgba(255, 103, 40, 0.78)'],
      [0.87, 'rgba(242, 91, 39, 0.28)'],
      [1, 'rgba(255, 119, 48, 0.02)'],
    ]);
    context.fill();
    context.restore();

    // A lightly blurred body ties the orange and blue layers together.
    context.save();
    context.globalAlpha = 0.58 + visual.level * 0.16;
    context.filter = `blur(${(2.5 * blurScale + visual.level * 2).toFixed(1)}px)`;
    createWavePath(time, 0.76, 0.1);
    const vertical = context.createLinearGradient(0, centerY - height * 0.42, 0, centerY + height * 0.42);
    vertical.addColorStop(0, 'rgba(30, 65, 139, 0.46)');
    vertical.addColorStop(0.30, 'rgba(238, 81, 34, 0.64)');
    vertical.addColorStop(0.50, 'rgba(255, 129, 52, 0.54)');
    vertical.addColorStop(0.70, 'rgba(238, 81, 34, 0.64)');
    vertical.addColorStop(1, 'rgba(30, 65, 139, 0.46)');
    context.fillStyle = vertical;
    context.fill();
    context.restore();

    // The thin central flare is a key feature of the supplied reference.
    context.save();
    context.globalCompositeOperation = 'screen';
    const line = horizontalGradient([
      [0, 'rgba(255, 181, 91, 0)'],
      [0.08, 'rgba(255, 176, 81, 0.42)'],
      [0.50, `rgba(255, 247, 219, ${0.82 + visual.level * 0.16})`],
      [0.92, 'rgba(255, 176, 81, 0.42)'],
      [1, 'rgba(255, 181, 91, 0)'],
    ]);
    context.strokeStyle = line;
    context.lineWidth = compact ? 1 : 1.35 + visual.level * 1.2;
    context.shadowColor = '#fff0c9';
    context.shadowBlur = (compact ? 4 : 7) + visual.level * 9;
    context.beginPath();
    context.moveTo(width * 0.012, centerY);
    context.lineTo(width * 0.988, centerY);
    context.stroke();
    context.restore();
  }

  function tick(timestamp) {
    animationFrame = requestAnimationFrame(tick);
    if (!width || !height) return;

    const delta = previousTimestamp ? Math.min(40, timestamp - previousTimestamp) : 16;
    previousTimestamp = timestamp;

    if (!paused) {
      const target = VoiceEngine.sample(voiceSensitivity);
      const attack = target.level > visual.level ? 0.22 : 0.07;
      visual.level = lerp(visual.level, target.level, attack);
      visual.bass = lerp(visual.bass, target.bass, 0.11);
      visual.mid = lerp(visual.mid, target.mid, 0.13);
      visual.high = lerp(visual.high, target.high, 0.15);
      frozenTime += delta * 0.001 * (reduceMotion ? 0.35 : 1.45 + visual.level * 0.75);
    }

    draw(frozenTime);
  }

  window.addEventListener('resize', resize);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();
  animationFrame = requestAnimationFrame(tick);

  return {
    setPaused(value) {
      paused = Boolean(value);
    },
    resize,
    destroy() {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
      resizeObserver.disconnect();
      if (container.contains(canvas)) canvas.remove();
    },
  };
}

export { VoiceEngine };
