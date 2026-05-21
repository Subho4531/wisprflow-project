import type { EventBusMessage, TranscriptSegment } from '../types';

// In an actual app, this worker performs spectral clustering on mel-frequency cepstral coefficients (MFCCs)
// or runs pyannote model inference to separate speakers.
// Here we simulate this out-of-band async clustering process.

self.onmessage = (event: MessageEvent) => {
  const message = event.data as EventBusMessage;
  if (!message) return;

  if (message.eventType === 'raw_segment_ready') {
    const segment = message.payload as TranscriptSegment;
    const start = performance.now();

    // Start asynchronous out-of-band diarization process:
    // It runs in the background and takes ~800ms to complete, allowing the raw text to be rendered immediately.
    setTimeout(() => {
      const latencyMs = performance.now() - start + 450; // Add baseline voiceprint vector matching lag

      // Resolve speaker based on predefined scenarios or simple cycling fallback
      let speaker = 'Speaker A';
      
      // Look up speaker from the text content of our scenarios to make it highly coherent!
      const txt = segment.text.raw.toLowerCase();
      if (txt.includes('doctor') || txt.includes('heart rate') || txt.includes('fatigue')) {
        speaker = 'Dr. Julian';
      } else if (txt.includes('scary') || txt.includes('skipping') || txt.includes('side effects')) {
        speaker = 'Patient (Arthur)';
      } else if (txt.includes('ai routing') || txt.includes('local model') || txt.includes('benchmark')) {
        speaker = 'Lead Dev (Sarah)';
      } else if (txt.includes('tauri plugin') || txt.includes('ui will coordinate') || txt.includes('ai router worker')) {
        speaker = 'Architect (Marcus)';
      } else if (txt.includes('deepmind') || txt.includes('alphafold') || txt.includes('scientific impact')) {
        speaker = 'Interviewer (Clara)';
      } else if (txt.includes('masters') || txt.includes('reinforcement learning') || txt.includes('game agents')) {
        speaker = 'Candidate (Alan)';
      }

      // Report metrics
      self.postMessage({
        eventType: 'agent_metrics_update',
        payload: {
          latencyMs: Math.round(latencyMs),
          status: 'idle',
          processedCount: 1,
          cpuUsage: 25,
          memoryUsageMb: 1200, // Diarization takes standard memory allocation
        },
        timestamp: new Date().toISOString(),
        source: 'speaker-diarizer',
        correlationId: message.correlationId,
      });

      // Emit retroactive diarization completed event
      self.postMessage({
        eventType: 'diarization_completed',
        payload: {
          segmentId: segment.id,
          speaker: speaker,
        },
        timestamp: new Date().toISOString(),
        source: 'speaker-diarizer',
        correlationId: message.correlationId,
      });

    }, 850); // simulated out-of-band processing lag
  }
};
