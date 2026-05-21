import './style.css';
import { eventBus } from './event-bus';
import type { TranscriptSegment, UserPreferences, AgentMetrics } from './types';

// ==========================================================================
// 1. STATE CONFIGURATIONS & INITIALIZATION
// ==========================================================================

const sessionSegments: Map<string, TranscriptSegment> = new Map();
let isRecording = false;
let recordingTimer: number | null = null;
let recordingSeconds = 0;
let simulationInterval: number | null = null;

// Secure in-memory user preferences
const userPreferences: UserPreferences = {
  aiMode: 'local',
  resourceProfile: 'standard',
  fillerWordRemoval: true,
  numberFormatting: true,
  punctuationInsertion: true,
  capitalization: true,
  openaiKey: '',
  anthropicKey: '',
  geminiKey: '',
  fillerWords: ['um', 'uh', 'like', 'you know', 'basically', 'actually', 'so', 'right'],
  acronyms: {
    't c p i p': 'TCP/IP',
    'a i': 'AI',
    'i p c': 'IPC',
    'l l m': 'LLM',
    'g g u f': 'GGUF',
    'u i': 'UI',
    'u c s c': 'UCSC',
    'h t m l': 'HTML',
    'c s s': 'CSS',
  },
  properNouns: ['WisprType', 'Tauri', 'Rust', 'Whisper', 'Vite', 'TypeScript', 'Google', 'DeepMind', 'Gemini', 'Microsoft', 'Apple', 'Intel'],
};

// Web Audio API variables for mic capture
let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let analyserNode: AnalyserNode | null = null;
let audioSource: MediaStreamAudioSourceNode | null = null;


// ==========================================================================
// 2. WORKER THREAD SPAWNING & REGISTRATION
// ==========================================================================

// Create workers using Vite modular syntax (fully compatible with standard browser module loading)
const audioProcessorWorker = new Worker(new URL('./workers/audio-processor.worker.ts', import.meta.url), { type: 'module' });
const primaryTranscriberWorker = new Worker(new URL('./workers/primary-transcriber.worker.ts', import.meta.url), { type: 'module' });
const secondaryVerifierWorker = new Worker(new URL('./workers/secondary-verifier.worker.ts', import.meta.url), { type: 'module' });
const textProcessorWorker = new Worker(new URL('./workers/text-processor.worker.ts', import.meta.url), { type: 'module' });
const aiRouterWorker = new Worker(new URL('./workers/ai-router.worker.ts', import.meta.url), { type: 'module' });
const speakerDiarizerWorker = new Worker(new URL('./workers/speaker-diarizer.worker.ts', import.meta.url), { type: 'module' });
const contentAnalyzerWorker = new Worker(new URL('./workers/content-analyzer.worker.ts', import.meta.url), { type: 'module' });
const exportFormatterWorker = new Worker(new URL('./workers/export-formatter.worker.ts', import.meta.url), { type: 'module' });

// Register workers on main event bus
eventBus.registerWorker('audio-processor', audioProcessorWorker);
eventBus.registerWorker('primary-transcriber', primaryTranscriberWorker);
eventBus.registerWorker('secondary-verifier', secondaryVerifierWorker);
eventBus.registerWorker('text-processor', textProcessorWorker);
eventBus.registerWorker('ai-router', aiRouterWorker);
eventBus.registerWorker('speaker-diarizer', speakerDiarizerWorker);
eventBus.registerWorker('content-analyzer', contentAnalyzerWorker);
eventBus.registerWorker('export-formatter', exportFormatterWorker);

// Set initial configurations across all workers
broadcastPreferences();

function broadcastPreferences() {
  const data = {
    aiMode: userPreferences.aiMode,
    resourceProfile: userPreferences.resourceProfile,
    fillerWordRemoval: userPreferences.fillerWordRemoval,
    numberFormatting: userPreferences.numberFormatting,
    punctuationInsertion: userPreferences.punctuationInsertion,
    capitalization: userPreferences.capitalization,
    openaiKey: userPreferences.openaiKey,
    anthropicKey: userPreferences.anthropicKey,
    geminiKey: userPreferences.geminiKey,
    fillerWords: [...userPreferences.fillerWords],
    acronyms: { ...userPreferences.acronyms },
    properNouns: [...userPreferences.properNouns]
  };

  eventBus.publish('preferences_updated', data, 'main-thread');
}

// ==========================================================================
// 3. UI ELEMENT REFERENCES
// ==========================================================================

const btnRecord = document.getElementById('btn-record') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const btnOpenSettings = document.getElementById('btn-open-settings') as HTMLButtonElement;
const btnCloseSettings = document.getElementById('btn-close-settings') as HTMLButtonElement;
const btnSaveSettings = document.getElementById('btn-save-settings') as HTMLButtonElement;
const btnCancelSettings = document.getElementById('btn-cancel-settings') as HTMLButtonElement;
const btnResetDemo = document.getElementById('btn-reset-demo') as HTMLButtonElement;
const btnClearLogs = document.getElementById('btn-clear-logs') as HTMLButtonElement;

const micSelect = document.getElementById('mic-select') as HTMLSelectElement;
const scenarioSelect = document.getElementById('scenario-select') as HTMLSelectElement;
const profileSelect = document.getElementById('resource-profile-select') as HTMLSelectElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const speakerFilter = document.getElementById('speaker-filter') as HTMLSelectElement;
const stateFilter = document.getElementById('state-filter') as HTMLSelectElement;

const transcriptPlaceholder = document.getElementById('transcript-placeholder') as HTMLDivElement;
const transcriptContainer = document.getElementById('transcript-segments-container') as HTMLDivElement;
const liveProcessingFooter = document.getElementById('live-processing-footer') as HTMLDivElement;
const liveProcessingMessage = document.getElementById('live-processing-message') as HTMLSpanElement;

const dialCpu = document.getElementById('dial-cpu') as HTMLSpanElement;
const dialRam = document.getElementById('dial-ram') as HTMLSpanElement;
const dialLatency = document.getElementById('dial-latency') as HTMLSpanElement;
const agentsTelemetryContainer = document.getElementById('agents-telemetry-container') as HTMLDivElement;
const loggerConsoleStream = document.getElementById('logger-console-stream') as HTMLDivElement;
const waveformCanvas = document.getElementById('waveform-canvas') as HTMLCanvasElement;
const dbIndicator = document.getElementById('telemetry-db') as HTMLSpanElement;
const pulseRing = document.getElementById('recording-pulse') as HTMLDivElement;

const settingsModal = document.getElementById('settings-modal') as HTMLDivElement;
const actionItemsList = document.getElementById('action-items-list') as HTMLUListElement;
const keywordsCloud = document.getElementById('keywords-cloud') as HTMLDivElement;

const sentimentScoreValue = document.getElementById('sentiment-score-value') as HTMLSpanElement;
const sentimentBarFill = document.getElementById('sentiment-bar-fill') as HTMLDivElement;
const sentimentPos = document.getElementById('sentiment-pos') as HTMLSpanElement;
const sentimentNeu = document.getElementById('sentiment-neu') as HTMLSpanElement;
const sentimentNeg = document.getElementById('sentiment-neg') as HTMLSpanElement;

const badgeTotalWords = document.getElementById('badge-total-words') as HTMLSpanElement;
const badgeAvgConfidence = document.getElementById('badge-avg-confidence') as HTMLSpanElement;

const btnExportTxt = document.getElementById('btn-export-txt') as HTMLButtonElement;
const btnExportSrt = document.getElementById('btn-export-srt') as HTMLButtonElement;
const btnExportDocx = document.getElementById('btn-export-docx') as HTMLButtonElement;
const btnExportJson = document.getElementById('btn-export-json') as HTMLButtonElement;

// Settings Form Controls
const aiModeSelect = document.getElementById('ai-mode-select') as HTMLSelectElement;
const keyOpenAI = document.getElementById('input-key-openai') as HTMLInputElement;
const keyGemini = document.getElementById('input-key-gemini') as HTMLInputElement;
const keyAnthropic = document.getElementById('input-key-anthropic') as HTMLInputElement;

const chkFillerWord = document.getElementById('chk-filler-word') as HTMLInputElement;
const chkPunctuation = document.getElementById('chk-punctuation') as HTMLInputElement;
const chkCapitalization = document.getElementById('chk-capitalization') as HTMLInputElement;
const chkNumbers = document.getElementById('chk-numbers') as HTMLInputElement;

const txtProperNouns = document.getElementById('dict-proper-nouns') as HTMLTextAreaElement;
const txtAcronyms = document.getElementById('dict-acronyms') as HTMLTextAreaElement;
const txtFillerWords = document.getElementById('dict-filler-words') as HTMLTextAreaElement;

// ==========================================================================
// 4. UI INTERACTIVE HANDLERS (TABS & MODALS)
// ==========================================================================

// Wire tab click handlers (Summary / Keywords / Sentiment)
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    document.getElementById(`tab-${tabId}`)?.classList.add('active');
  });
});

// Wire modal tab click handlers
document.querySelectorAll('.modal-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.modal-tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.modal-tab-pane').forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    const tabId = btn.getAttribute('data-modaltab');
    document.getElementById(`modaltab-${tabId}`)?.classList.add('active');
  });
});

// Modal open/close
btnOpenSettings.addEventListener('click', () => {
  // Set form values from current preferences
  aiModeSelect.value = userPreferences.aiMode;
  keyOpenAI.value = userPreferences.openaiKey;
  keyGemini.value = userPreferences.geminiKey;
  keyAnthropic.value = userPreferences.anthropicKey;

  chkFillerWord.checked = userPreferences.fillerWordRemoval;
  chkPunctuation.checked = userPreferences.punctuationInsertion;
  chkCapitalization.checked = userPreferences.capitalization;
  chkNumbers.checked = userPreferences.numberFormatting;

  txtProperNouns.value = userPreferences.properNouns.join(', ');
  txtFillerWords.value = userPreferences.fillerWords.join(', ');
  
  txtAcronyms.value = Object.entries(userPreferences.acronyms)
    .map(([phrase, replaced]) => `${phrase}=${replaced}`)
    .join('\n');

  settingsModal.classList.remove('hidden');
});

function hideSettings() {
  settingsModal.classList.add('hidden');
}

btnCloseSettings.addEventListener('click', hideSettings);
btnCancelSettings.addEventListener('click', hideSettings);

btnSaveSettings.addEventListener('click', () => {
  // Parse inputs back to userPreferences state
  userPreferences.aiMode = aiModeSelect.value as any;
  userPreferences.openaiKey = keyOpenAI.value.trim();
  userPreferences.geminiKey = keyGemini.value.trim();
  userPreferences.anthropicKey = keyAnthropic.value.trim();

  userPreferences.fillerWordRemoval = chkFillerWord.checked;
  userPreferences.punctuationInsertion = chkPunctuation.checked;
  userPreferences.capitalization = chkCapitalization.checked;
  userPreferences.numberFormatting = chkNumbers.checked;

  userPreferences.properNouns = txtProperNouns.value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  userPreferences.fillerWords = txtFillerWords.value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const newAcronyms: Record<string, string> = {};
  txtAcronyms.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('='))
    .forEach((line) => {
      const parts = line.split('=');
      if (parts.length === 2) {
        newAcronyms[parts[0].trim().toLowerCase()] = parts[1].trim();
      }
    });
  userPreferences.acronyms = newAcronyms;

  // Broadcast updates
  broadcastPreferences();
  hideSettings();

  logToConsole('System', `Preferences updated. Formatting rules and vocabularies synced.`);
});

// Reset session
btnResetDemo.addEventListener('click', () => {
  if (isRecording) {
    stopRecordingSession();
  }
  sessionSegments.clear();
  renderTranscript();
  updateStats();
  
  actionItemsList.innerHTML = `<li class="empty-item-msg">Awaiting transcript segments to extract checklist items...</li>`;
  keywordsCloud.innerHTML = `<span class="empty-item-msg">Awaiting topics...</span>`;
  
  sentimentScoreValue.innerText = 'Neutral (0.0)';
  sentimentBarFill.style.width = '50%';
  sentimentPos.innerText = 'Pos: 0%';
  sentimentNeu.innerText = 'Neu: 100%';
  sentimentNeg.innerText = 'Neg: 0%';

  speakerFilter.innerHTML = '<option value="all">All Speakers</option>';
  
  logToConsole('System', 'Session segments and insight caches successfully purged.');
});

// Clear console
btnClearLogs.addEventListener('click', () => {
  loggerConsoleStream.innerHTML = '';
});

// Preset scenario selection
scenarioSelect.addEventListener('click', () => {
  eventBus.publish('select_scenario', { scenario: scenarioSelect.value }, 'main-thread');
});

// Resource profile allocation
profileSelect.addEventListener('change', () => {
  userPreferences.resourceProfile = profileSelect.value as any;
  
  // Model loading simulation badge updates
  const whisperBadge = document.getElementById('whisper-size-badge') as HTMLSpanElement;
  const whisperProgress = document.getElementById('whisper-progress') as HTMLDivElement;
  const llmBadge = document.getElementById('llm-size-badge') as HTMLSpanElement;
  const llmProgress = document.getElementById('llm-progress') as HTMLDivElement;

  if (profileSelect.value === 'lite') {
    whisperBadge.innerText = 'Tiny (75MB)';
    llmBadge.innerText = 'TinyLlama (700MB)';
    simulateProgressFill(whisperProgress, 'animated');
    simulateProgressFill(llmProgress, 'animated-blue');
  } else if (profileSelect.value === 'standard') {
    whisperBadge.innerText = 'Small (240MB)';
    llmBadge.innerText = 'Phi-3-mini (2.3GB)';
    simulateProgressFill(whisperProgress, 'animated');
    simulateProgressFill(llmProgress, 'animated-blue');
  } else if (profileSelect.value === 'pro') {
    whisperBadge.innerText = 'Medium (760MB)';
    llmBadge.innerText = 'Gemma-2B (1.5GB)';
    simulateProgressFill(whisperProgress, 'animated');
    simulateProgressFill(llmProgress, 'animated-blue');
  }

  broadcastPreferences();
  logToConsole('System', `Resource Profile switched to [${profileSelect.value.toUpperCase()}]. Reloading model matrices.`);
});

function simulateProgressFill(el: HTMLDivElement, animClass: string) {
  el.style.width = '0%';
  setTimeout(() => {
    el.classList.remove(animClass);
    void el.offsetWidth; // trigger reflow
    el.classList.add(animClass);
    el.style.width = '100%';
  }, 50);
}

// Search and filter listeners
searchInput.addEventListener('input', () => {
  if (searchInput.value.trim() !== '') {
    searchInput.parentElement?.classList.add('search-input-active');
  } else {
    searchInput.parentElement?.classList.remove('search-input-active');
  }
  renderTranscript();
});
speakerFilter.addEventListener('change', renderTranscript);
stateFilter.addEventListener('change', renderTranscript);

// ==========================================================================
// 5. WAVEFORM VISUALIZATION & AUDIO SYSTEM
// ==========================================================================

const canvasCtx = waveformCanvas.getContext('2d')!;

// Draw dynamic waves. Uses live microphone frequency data if recording,
// else oscillates a futuristic visual standby wave.
function drawWaveform() {
  requestAnimationFrame(drawWaveform);

  const width = waveformCanvas.width = waveformCanvas.parentElement!.clientWidth;
  const height = waveformCanvas.height = 90;

  canvasCtx.fillStyle = 'rgba(5, 5, 8, 1)';
  canvasCtx.fillRect(0, 0, width, height);

  if (isRecording && analyserNode) {
    // 1. Draw live audio frequency data
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteTimeDomainData(dataArray);

    canvasCtx.lineWidth = 2.5;
    canvasCtx.strokeStyle = 'hsl(217, 91%, 60%)'; // glowing secondary blue

    canvasCtx.beginPath();
    const sliceWidth = width / bufferLength;
    let x = 0;

    // Detect decibel output roughly
    let sumSquares = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * height) / 2;

      const deviation = v - 1.0;
      sumSquares += deviation * deviation;

      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }
      x += sliceWidth;
    }
    canvasCtx.lineTo(width, height / 2);
    canvasCtx.stroke();

    const rms = Math.sqrt(sumSquares / bufferLength);
    const db = rms > 0 ? Math.round(20 * Math.log10(rms)) : -96;
    dbIndicator.innerText = `${Math.max(db, -96)} dB`;
    dbIndicator.className = 'telemetry-value text-green';

  } else {
    // 2. Standby visual waves animation (Sine curves oscillating slowly)
    const time = Date.now() * 0.004;
    canvasCtx.lineWidth = 1.5;
    
    // Draw 3 layers of glowing sine waves
    for (let l = 0; l < 3; l++) {
      canvasCtx.beginPath();
      canvasCtx.strokeStyle = l === 0 
        ? 'rgba(168, 85, 247, 0.4)' // Purple
        : l === 1 
          ? 'rgba(59, 130, 246, 0.3)' // Blue
          : 'rgba(236, 72, 153, 0.15)'; // Pink
      
      const speedMultiplier = (l + 1) * 0.5;
      const amplitude = 12 / (l + 1);
      
      for (let x = 0; x < width; x++) {
        const y = height / 2 + Math.sin(x * 0.015 + time * speedMultiplier) * amplitude * Math.sin(x / width * Math.PI);
        if (x === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }
      }
      canvasCtx.stroke();
    }
    dbIndicator.innerText = '-96 dB';
    dbIndicator.className = 'telemetry-value text-purple';
  }
}

// Initialize standby animation immediately
drawWaveform();

// ==========================================================================
// 6. RECORDING MANAGEMENT & CAPTURING PIPELINES
// ==========================================================================

btnRecord.addEventListener('click', async () => {
  if (!isRecording) {
    await startRecordingSession();
  } else {
    stopRecordingSession();
  }
});

btnStop.addEventListener('click', () => {
  if (isRecording) {
    stopRecordingSession();
  }
});

async function startRecordingSession() {
  const correlationId = Math.random().toString(36).substring(2, 11);
  isRecording = true;
  recordingSeconds = 0;

  // Visual state updates
  btnRecord.classList.add('active');
  btnRecord.innerHTML = `<span class="record-icon-dot"></span><span>Capturing...</span>`;
  btnStop.classList.remove('disabled');
  btnStop.disabled = false;
  pulseRing.classList.remove('hidden');
  liveProcessingFooter.classList.remove('hidden');
  liveProcessingMessage.innerText = 'Whisper is listening...';

  logToConsole('System', `Recording session triggered. correlationId: [${correlationId}]`);

  // Try to request microphone capture using Web Audio APIs
  try {
    if (micSelect.value === 'default') {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 256;
      audioSource = audioContext.createMediaStreamSource(micStream);
      audioSource.connect(analyserNode);
      
      logToConsole('Audio Processor', 'Web Audio microphone capture initialized successfully.');
    } else {
      logToConsole('Audio Processor', 'Running simulated audio preset flow.');
    }
  } catch (err) {
    console.warn('Microphone access denied or unavailable, running preset audio simulation:', err);
    logToConsole('Audio Processor', 'Warning: Mic blocked. Running premium preset scenario simulation.');
    micSelect.value = 'simulated';
  }

  // Publish start recording onto event bus
  eventBus.publish('start_recording', { sampleRate: 16000 }, 'main-thread', correlationId);
  eventBus.publish('select_scenario', { scenario: scenarioSelect.value }, 'main-thread', correlationId);

  // Setup duration timer
  recordingTimer = window.setInterval(() => {
    recordingSeconds++;
  }, 1000);

  // Trigger simulated 2s audio chunks to feed the Whisper pipeline
  let chunkIndex = 0;
  simulationInterval = window.setInterval(() => {
    chunkIndex++;
    // Post PCM floating segments
    eventBus.publish('audio_chunk_ready', {
      chunkIndex,
      duration: 2.0,
      pcmFeatures: Array.from({ length: 120 }, () => Math.random() * 2 - 1)
    }, 'audio-processor', correlationId);
  }, 5000); // Trigger a scenario text segment every 5 seconds!
}

function stopRecordingSession() {
  isRecording = false;
  
  // Revert buttons
  btnRecord.classList.remove('active');
  btnRecord.innerHTML = `<span class="record-icon-dot"></span><span>Capture Session</span>`;
  btnStop.classList.add('disabled');
  btnStop.disabled = true;
  pulseRing.classList.add('hidden');
  liveProcessingFooter.classList.add('hidden');

  logToConsole('System', 'Stop recording signal broadcast.');

  // Publish stop recording
  eventBus.publish('stop_recording', {}, 'main-thread');

  // Terminate intervals and tracks
  if (recordingTimer) clearInterval(recordingTimer);
  if (simulationInterval) clearInterval(simulationInterval);
  
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  analyserNode = null;
  audioSource = null;

  // Dispatch final aggregate analysis command
  const segments = Array.from(sessionSegments.values());
  eventBus.publish('recording_session_ended', segments, 'main-thread');
}

// ==========================================================================
// 7. EVENT BUS LOGGING & TELEMETRY PANEL
// ==========================================================================

// Logging utility to the scrolling console
function logToConsole(source: string, text: string) {
  const line = document.createElement('div');
  line.className = `console-line source-${source.toLowerCase().replace(/\s+/g, '-')}`;
  
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.innerHTML = `[${time}] <span class="console-source">[${source}]</span> ${escapeHtml(text)}`;
  
  loggerConsoleStream.appendChild(line);
  loggerConsoleStream.scrollTop = loggerConsoleStream.scrollHeight;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Listen to all events for diagnostic streaming logs
eventBus.subscribe('*', (message) => {
  // Exclude high-frequency noise-update metrics to avoid crashing the logging viewport
  if (message.eventType === 'agent_metrics_update' || message.eventType === 'telemetry_updated' || message.eventType === 'waveform_update') {
    return;
  }

  const payloadSnippet = JSON.stringify(message.payload);
  const truncatedSnippet = payloadSnippet.length > 85 ? payloadSnippet.substring(0, 85) + '...' : payloadSnippet;
  
  logToConsole(message.source, `Emitted event "${message.eventType}": ${truncatedSnippet}`);
});

// Listen for visual waveform amplitude updates from simulated audio processes
eventBus.subscribe('waveform_update', (message) => {
  if (micSelect.value === 'simulated') {
    const payload = message.payload;
    const peak = payload.amplitude || 0.1;
    const snr = payload.snr || 24;
    
    // Animate waveform mock on simulated select
    canvasCtx.fillStyle = 'rgba(5, 5, 8, 1)';
    const width = waveformCanvas.width = waveformCanvas.parentElement!.clientWidth;
    const height = waveformCanvas.height = 90;
    canvasCtx.fillRect(0, 0, width, height);

    canvasCtx.lineWidth = 2.5;
    canvasCtx.strokeStyle = 'hsl(142, 71%, 45%)';
    canvasCtx.beginPath();
    
    const sliceWidth = width / 60;
    let x = 0;
    for (let i = 0; i < 60; i++) {
      const osc = Math.sin(i * 0.3) * peak * height * 0.4;
      const y = height / 2 + osc;
      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }
      x += sliceWidth;
    }
    canvasCtx.stroke();
    
    // Decibel estimation
    const db = Math.round(20 * Math.log10(peak + 0.0001));
    dbIndicator.innerText = `${Math.max(db, -96)} dB | SNR: ${snr}dB`;
    dbIndicator.className = 'telemetry-value text-green';
  }
});

// Telemetry values subscriber
eventBus.subscribe('telemetry_updated', (message) => {
  const t = message.payload;
  dialCpu.innerText = `${t.cpuUsage}%`;
  dialRam.innerText = `${t.memoryUsageMb} MB`;
  dialLatency.innerText = `${t.latencyMs}ms`;

  // Re-render the threads list
  renderAgentThreads();
});

function renderAgentThreads() {
  const metrics = eventBus.getAgentMetrics();
  agentsTelemetryContainer.innerHTML = '';

  Object.values(metrics).forEach((m: AgentMetrics) => {
    const row = document.createElement('div');
    row.className = 'thread-row';
    
    row.innerHTML = `
      <span class="thread-status-dot ${m.status}"></span>
      <span class="thread-name">${m.displayName}</span>
      <div class="thread-metrics">
        <div class="metric-item"><span>LAT:</span>${m.latencyMs}ms</div>
        <div class="metric-item"><span>CPU:</span>${m.cpuUsage}%</div>
        <div class="metric-item"><span>MEM:</span>${m.memoryUsageMb}MB</div>
      </div>
    `;

    agentsTelemetryContainer.appendChild(row);
  });
}

// Wires immediate initial threads draw
renderAgentThreads();

// ==========================================================================
// 8. PROGRESSIVE TRANSCRIPT DRAW & EVENT ROUTING
// ==========================================================================

// Segment 1: RAW Whisper
eventBus.subscribe('raw_segment_ready', (message) => {
  const segment = message.payload as TranscriptSegment;
  
  sessionSegments.set(segment.id, segment);
  renderTranscript();
  updateStats();
  
  // Populate the speaker filter dropdown dynamically as speakers are resolved
  populateSpeakersFilter();
});

// Segment 2: FORMATTED Punctuation Formatter
eventBus.subscribe('format_completed', (message) => {
  const segment = message.payload as TranscriptSegment;
  
  if (sessionSegments.has(segment.id)) {
    const existing = sessionSegments.get(segment.id)!;
    // Overwrite formatted texts
    existing.text.formatted = segment.text.formatted;
    existing.state = 'formatted';
    
    renderTranscript();
  }
});

// Segment 3: AI ENHANCED LLM Polished
eventBus.subscribe('ai_enhanced', (message) => {
  const payload = message.payload;
  const segment = payload.segment as TranscriptSegment;
  
  if (sessionSegments.has(segment.id)) {
    const existing = sessionSegments.get(segment.id)!;
    existing.text.aiEnhanced = segment.text.aiEnhanced;
    existing.state = 'enhanced';
    
    renderTranscript();
    updateStats();
  }
});

// Segment 4: FINAL Speaker Diarization cluster match
eventBus.subscribe('diarization_completed', (message) => {
  const payload = message.payload;
  const { segmentId, speaker } = payload;
  
  if (sessionSegments.has(segmentId)) {
    const existing = sessionSegments.get(segmentId)!;
    existing.speaker = speaker;
    existing.state = 'final';
    
    renderTranscript();
    populateSpeakersFilter();
  }
});

// Populate dropdown filters
function populateSpeakersFilter() {
  const speakers: Set<string> = new Set();
  sessionSegments.forEach((s) => {
    if (s.speaker && s.speaker !== 'Unknown') {
      speakers.add(s.speaker);
    }
  });

  const currentSelection = speakerFilter.value;
  speakerFilter.innerHTML = '<option value="all">All Speakers</option>';
  
  speakers.forEach((spk) => {
    const opt = document.createElement('option');
    opt.value = spk;
    opt.innerText = spk;
    speakerFilter.appendChild(opt);
  });

  speakerFilter.value = currentSelection;
}

// Stats count updates
function updateStats() {
  let wordCount = 0;
  let confSum = 0;
  let count = 0;

  sessionSegments.forEach((s) => {
    const text = s.text.aiEnhanced || s.text.formatted || s.text.raw;
    if (text) {
      wordCount += text.split(/\s+/).filter(Boolean).length;
    }
    confSum += s.confidence;
    count++;
  });

  badgeTotalWords.innerText = `${wordCount} words`;
  badgeAvgConfidence.innerText = count > 0 
    ? `${Math.round((confSum / count) * 100)}% confidence`
    : '100% confidence';
}

// Progressive Transcript DOM Renderer
function renderTranscript() {
  const container = transcriptContainer;
  const searchVal = searchInput.value.toLowerCase().trim();
  const filterSpk = speakerFilter.value;
  const filterState = stateFilter.value;

  const list = Array.from(sessionSegments.values()).sort((a, b) => a.timestampStart - b.timestampStart);

  if (list.length === 0) {
    transcriptPlaceholder.classList.remove('hidden');
    container.classList.add('hidden');
    return;
  }

  transcriptPlaceholder.classList.add('hidden');
  container.classList.remove('hidden');
  container.innerHTML = '';

  list.forEach((seg) => {
    // 1. Apply Search and Filters
    const segmentText = (seg.text.aiEnhanced || seg.text.formatted || seg.text.raw).toLowerCase();
    if (searchVal !== '' && !segmentText.includes(searchVal)) return;
    if (filterSpk !== 'all' && seg.speaker !== filterSpk) return;
    if (filterState !== 'all' && seg.state !== filterState) return;

    // 2. Build DOM element
    const segDiv = document.createElement('div');
    
    // Class names: speaker classes handle avatar coloring dynamically
    const speakerClass = `speaker-${seg.speaker.replace(/[^a-zA-Z0-9]/g, '_')}`;
    segDiv.className = `segment-item state-${seg.state} ${speakerClass}`;

    // Format timestamps
    const formatTime = (sec: number) => {
      const minutes = Math.floor(sec / 60);
      const seconds = Math.floor(sec % 60);
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    // Output visual display text depending on progressive state level
    let displayText = seg.text.raw;
    let stateLabel = 'Whispering...';

    if (seg.state === 'formatted') {
      displayText = seg.text.formatted || seg.text.raw;
      stateLabel = 'Formatted';
    } else if (seg.state === 'enhanced') {
      displayText = seg.text.aiEnhanced || seg.text.formatted || seg.text.raw;
      stateLabel = 'AI Enhanced';
    } else if (seg.state === 'final') {
      displayText = seg.text.aiEnhanced || seg.text.formatted || seg.text.raw;
      stateLabel = 'Diarized';
    }

    // Highlight search match
    if (searchVal !== '') {
      const regex = new RegExp(`(${searchVal})`, 'gi');
      displayText = displayText.replace(regex, '<mark>$1</mark>');
    }

    // Render inner content
    segDiv.innerHTML = `
      <div class="segment-meta">
        <div class="segment-avatar">${seg.speaker.charAt(0)}</div>
        <span class="segment-speaker">${seg.speaker}</span>
        <span class="segment-state-badge">${stateLabel}</span>
        <span class="segment-time">${formatTime(seg.timestampStart)} - ${formatTime(seg.timestampEnd)}</span>
      </div>
      <div class="segment-body">${displayText}</div>
    `;

    container.appendChild(segDiv);
  });

  // Keep scrolled to bottom
  container.parentElement!.scrollTop = container.parentElement!.scrollHeight;
}

// ==========================================================================
// 9. INSIGHTS SUMMARY TAB & CHECKLIST CONTROLLERS
// ==========================================================================

eventBus.subscribe('content_analysis_done', (message) => {
  const analysis = message.payload;
  if (!analysis) return;

  // 1. Checklist Action Items
  const checklist = analysis.summary.actionItems;
  actionItemsList.innerHTML = '';
  
  if (checklist.length === 0) {
    actionItemsList.innerHTML = `<li class="empty-item-msg">Awaiting transcript segments to extract checklist items...</li>`;
  } else {
    checklist.forEach((item: any) => {
      const li = document.createElement('li');
      li.className = 'action-checkbox-item';
      
      const checkId = `task-${Math.random().toString(36).substring(2, 9)}`;
      
      li.innerHTML = `
        <input type="checkbox" id="${checkId}" />
        <label for="${checkId}"><strong>${item.assignee}</strong>: ${item.task} <span class="badge ${item.priority === 'high' ? 'badge-red' : 'badge-gray'}">${item.priority.toUpperCase()}</span></label>
      `;

      li.querySelector('input')?.addEventListener('change', (e) => {
        if ((e.target as HTMLInputElement).checked) {
          li.classList.add('checked');
        } else {
          li.classList.remove('checked');
        }
      });

      actionItemsList.appendChild(li);
    });
  }

  // 2. Keyword cloud tags
  const keywords = analysis.keywords;
  keywordsCloud.innerHTML = '';
  
  if (keywords.length === 0) {
    keywordsCloud.innerHTML = `<span class="empty-item-msg">Awaiting topics...</span>`;
  } else {
    keywords.forEach((kw: any) => {
      const tag = document.createElement('span');
      tag.className = 'keyword-tag';
      tag.innerHTML = `${kw.word} <span class="tag-score">${Math.round(kw.score)}</span>`;
      keywordsCloud.appendChild(tag);
    });
  }

  // 3. Sentiment widget scores
  const sent = analysis.sentiment;
  sentimentScoreValue.innerText = `${sent.label.toUpperCase()} (${Math.round(sent.score * 10) / 10})`;
  
  // Set emoji
  const faceEl = document.querySelector('.sentiment-face') as HTMLSpanElement;
  if (sent.label === 'positive') {
    faceEl.innerText = '😊';
  } else if (sent.label === 'negative') {
    faceEl.innerText = '😟';
  } else {
    faceEl.innerText = '😐';
  }

  // Bar fill (score ranges -1 to +1, map to 0% to 100%)
  const percentage = Math.round((sent.score + 1) * 50);
  sentimentBarFill.style.width = `${percentage}%`;

  // Sentiment metrics breakdown tags
  const totalEmotions = sent.emotions.joy + sent.emotions.anticipation + sent.emotions.trust + sent.emotions.fear;
  if (totalEmotions > 0) {
    const posPercent = Math.round(((sent.emotions.joy + sent.emotions.trust) / Math.max(1, sent.emotions.joy + sent.emotions.trust + sent.emotions.fear)) * 100);
    const negPercent = Math.round((sent.emotions.fear / Math.max(1, sent.emotions.joy + sent.emotions.trust + sent.emotions.fear)) * 100);
    const neuPercent = Math.max(0, 100 - posPercent - negPercent);

    sentimentPos.innerText = `Pos: ${posPercent}%`;
    sentimentNeu.innerText = `Neu: ${neuPercent}%`;
    sentimentNeg.innerText = `Neg: ${negPercent}%`;
  }
});

// ==========================================================================
// 10. EXPORT FORMATTER PIPELINE HANDLERS
// ==========================================================================

btnExportTxt.addEventListener('click', () => requestExportSession('txt'));
btnExportSrt.addEventListener('click', () => requestExportSession('srt'));
btnExportDocx.addEventListener('click', () => requestExportSession('docx'));
btnExportJson.addEventListener('click', () => requestExportSession('json'));

function requestExportSession(format: 'txt' | 'srt' | 'docx' | 'json') {
  const segments = Array.from(sessionSegments.values()).sort((a, b) => a.timestampStart - b.timestampStart);
  if (segments.length === 0) {
    logToConsole('System', 'Error: Cannot export an empty session. Please record some segments first.');
    return;
  }

  logToConsole('Export Formatter', `Requesting compilation to formatting type [${format.toUpperCase()}]`);
  eventBus.publish('request_export', { format, segments }, 'main-thread');
}

// Receive compiled export bundles
eventBus.subscribe('export_finished', (message) => {
  const payload = message.payload;
  const { fileContent, mimeType, filename } = payload;

  logToConsole('Export Formatter', `Formatting complete. Triggering client downloader for [${filename}]`);

  // Download the formatted file automatically in the browser client
  const blob = new Blob([fileContent], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  
  // Clean up
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
