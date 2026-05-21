import type { EventBusMessage } from '../types';

let isRecording = false;
let sampleRate = 16000;
let accumulatedBuffer: number[] = [];
const chunkDurationSec = 2.0; // 2 seconds chunks
const targetSize = sampleRate * chunkDurationSec;

// Listen for audio processing events
self.onmessage = (event: MessageEvent) => {
  const message = event.data as EventBusMessage;
  if (!message) return;

  if (message.eventType === 'start_recording') {
    isRecording = true;
    accumulatedBuffer = [];
    sampleRate = message.payload.sampleRate || 16000;
    
    self.postMessage({
      eventType: 'agent_metrics_update',
      payload: { status: 'running', latencyMs: 2, processedCount: 0, cpuUsage: 5, memoryUsageMb: 12.4 },
      timestamp: new Date().toISOString(),
      source: 'audio-processor',
      correlationId: message.correlationId,
    });
    return;
  }

  if (message.eventType === 'stop_recording') {
    isRecording = false;
    
    // Process remaining buffer
    if (accumulatedBuffer.length > 0) {
      processAudioChunk(accumulatedBuffer, message.correlationId);
    }
    
    accumulatedBuffer = [];
    self.postMessage({
      eventType: 'agent_metrics_update',
      payload: { status: 'idle', latencyMs: 0, cpuUsage: 0, memoryUsageMb: 6.2 },
      timestamp: new Date().toISOString(),
      source: 'audio-processor',
      correlationId: message.correlationId,
    });
    return;
  }

  if (message.eventType === 'audio_data' && isRecording) {
    const rawPCM = event.data.payload as number[]; // Array of floats (-1.0 to 1.0)
    if (!rawPCM || rawPCM.length === 0) return;

    const start = performance.now();

    // 1. Audio Preprocessing & Normalization
    const normalizedPCM = normalizeAudio(rawPCM);

    // Accumulate buffer
    accumulatedBuffer.push(...normalizedPCM);

    // 2. Waveform Amplitude Visual Telemetry (emit high-frequency peak updates)
    const peak = getPeakAmplitude(normalizedPCM);
    const snr = estimateSNR(normalizedPCM);

    self.postMessage({
      eventType: 'waveform_update',
      payload: {
        amplitude: peak,
        snr: snr,
        duration: accumulatedBuffer.length / sampleRate,
      },
      timestamp: new Date().toISOString(),
      source: 'audio-processor',
      correlationId: message.correlationId,
    });

    const latencyMs = performance.now() - start;

    // Check if chunk is full
    if (accumulatedBuffer.length >= targetSize) {
      const chunk = accumulatedBuffer.slice(0, targetSize);
      accumulatedBuffer = accumulatedBuffer.slice(targetSize);

      processAudioChunk(chunk, message.correlationId);
    }

    // Update worker metrics
    self.postMessage({
      eventType: 'agent_metrics_update',
      payload: {
        latencyMs: Math.round(latencyMs * 10) / 10,
        status: 'running',
        processedCount: accumulatedBuffer.length,
        cpuUsage: 14,
        memoryUsageMb: 14.8,
      },
      timestamp: new Date().toISOString(),
      source: 'audio-processor',
      correlationId: message.correlationId,
    });
  }
};

function normalizeAudio(pcm: number[]): number[] {
  let maxVal = 0;
  for (let i = 0; i < pcm.length; i++) {
    const absVal = Math.abs(pcm[i]);
    if (absVal > maxVal) maxVal = absVal;
  }

  // Avoid divide by zero
  if (maxVal === 0) return pcm;

  // Simple gain control (normalization)
  const targetGain = 0.9;
  const multiplier = targetGain / maxVal;

  // Apply smoothing multiplier if needed, otherwise linear
  return pcm.map((sample) => sample * multiplier);
}

function getPeakAmplitude(pcm: number[]): number {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const absVal = Math.abs(pcm[i]);
    if (absVal > peak) peak = absVal;
  }
  return peak;
}

function estimateSNR(pcm: number[]): number {
  // Simple signal-to-noise ratio estimation
  let signalEnergy = 0;
  let noiseEnergy = 0;

  for (let i = 0; i < pcm.length; i++) {
    const energy = pcm[i] * pcm[i];
    if (energy > 0.005) {
      signalEnergy += energy;
    } else {
      noiseEnergy += energy;
    }
  }

  const signalRMS = Math.sqrt(signalEnergy / Math.max(1, pcm.length));
  const noiseRMS = Math.sqrt(noiseEnergy / Math.max(1, pcm.length));

  if (noiseRMS === 0) return 30; // Perfect environment max
  
  const snrDb = 20 * Math.log10(signalRMS / noiseRMS);
  return Math.min(Math.max(Math.round(snrDb), 0), 30);
}

function processAudioChunk(chunk: number[], correlationId: string): void {
  // Emit audio chunk ready event
  self.postMessage({
    eventType: 'audio_chunk_ready',
    payload: {
      audioPCM: chunk,
      sampleRate: sampleRate,
      duration: chunk.length / sampleRate,
    },
    timestamp: new Date().toISOString(),
    source: 'audio-processor',
    correlationId: correlationId,
  });
}
