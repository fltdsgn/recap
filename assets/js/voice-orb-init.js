import { createVoiceOrb, VoiceEngine } from './voice-orb.js';

// Mount the two orb instances (main meeting screen + mini player). They
// share one microphone stream internally (see VoiceEngine in voice-orb.js).
const modalOrb = createVoiceOrb(document.getElementById('modal-waveform-orb'), {
  voiceSensitivity: 1.5,
  maxRotationSpeed: 1.2,
  maxHoverIntensity: 0.8,
});

const miniOrb = createVoiceOrb(document.getElementById('mini-waveform-orb'), {
  voiceSensitivity: 1.5,
  maxRotationSpeed: 1.2,
  maxHoverIntensity: 0.8,
});

// Bridge for script.js (a plain classic script, so it can't `import` this
// module) to pause/resume both orbs in lockstep with the meeting timer,
// and to request microphone access only once a meeting actually starts.
window.voiceOrbs = {
  modal: modalOrb,
  mini: miniOrb,
  start: () => VoiceEngine.start(),
  stop: () => VoiceEngine.stop(),
  // Lets script.js tell the user whether the orb is actually driven by
  // their real microphone or the procedural fallback (permission denied,
  // no mic, or an insecure/non-localhost origin).
  isUsingMic: () => VoiceEngine.usingMic,
};
