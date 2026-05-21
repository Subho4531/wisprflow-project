import type { EventBusMessage, TranscriptSegment } from '../types';

interface ScenarioSegment {
  speaker: string;
  text: string;
  duration: number; // in seconds
  confidence: number;
}

const SCENARIOS: Record<string, ScenarioSegment[]> = {
  medical: [
    { speaker: 'Doctor', text: 'uh ok so doctor checkup today. Basically the patient has been experiencing some palpitations and um like P V C s since yesterday.', duration: 5.0, confidence: 0.94 },
    { speaker: 'Patient', text: 'Yeah it is actually quite scary. It feels like my heart is basically skipping a beat every couple of minutes, especially when I am resting.', duration: 6.0, confidence: 0.91 },
    { speaker: 'Doctor', text: 'Right. Let us see. Yes, your heart rate is 95 b p m. I am going to write down twenty three point five milligram metoprolol t i d for you.', duration: 7.0, confidence: 0.96 },
    { speaker: 'Patient', text: 'Okay. Are there any side effects? Like, will it make me feel drowsy or so?', duration: 4.5, confidence: 0.89 },
    { speaker: 'Doctor', text: 'Yes, mild fatigue is common. We will monitor it closely. Please secure a follow-up in two weeks.', duration: 5.5, confidence: 0.97 }
  ],
  architecture: [
    { speaker: 'Lead Dev', text: 'right so we are setting up the new a i routing. We need to establish the connection via t c p i p to the l l m runner.', duration: 5.5, confidence: 0.95 },
    { speaker: 'Architect', text: 'um yes we can run the g g u f file natively inside a tauri plugin. The u i will coordinate everything without blocking the main thread, you know?', duration: 7.0, confidence: 0.92 },
    { speaker: 'Lead Dev', text: 'Perfect. That keeps everything local. What about the cloud fallback? If the local model is basically too slow, do we route to openai?', duration: 6.5, confidence: 0.94 },
    { speaker: 'Architect', text: 'Exactly. The ai router worker handles the dispatch. If the local latency is over five hundred milliseconds, it falls back to cloud flash.', duration: 6.0, confidence: 0.96 },
    { speaker: 'Lead Dev', text: 'Excellent. Let us write a benchmark script for g g u f execution times.', duration: 4.5, confidence: 0.98 }
  ],
  casual: [
    { speaker: 'Interviewer', text: 'so tell me how you joined google deepmind? Like, it is basically a dream job for many software engineers, actually.', duration: 6.0, confidence: 0.92 },
    { speaker: 'Candidate', text: 'Yes, it was quite a journey. I joined in twenty fifteen after completing my masters at Stanford. I worked on reinforcement learning.', duration: 7.0, confidence: 0.95 },
    { speaker: 'Interviewer', text: 'Wow, that is amazing. Did you work on alphafold? Or was it more on the language models side?', duration: 5.5, confidence: 0.94 },
    { speaker: 'Candidate', text: 'I started on game agents, then transitioned to the protein folding team. We were aiming to solve a fifty year old biology challenge, you know.', duration: 7.0, confidence: 0.91 },
    { speaker: 'Interviewer', text: 'And you actually solved it. The scientific impact is absolutely incredible.', duration: 4.5, confidence: 0.97 }
  ]
};

let activeScenario = 'architecture';
let currentSegmentIndex = 0;
let timeOffset = 0;

// Listen for messages in the worker thread
self.onmessage = (event: MessageEvent) => {
  const message = event.data as EventBusMessage;
  if (!message) return;

  if (message.eventType === 'select_scenario') {
    activeScenario = message.payload.scenario;
    currentSegmentIndex = 0;
    timeOffset = 0;
    return;
  }

  if (message.eventType === 'start_recording') {
    self.postMessage({
      eventType: 'agent_metrics_update',
      payload: { status: 'running', latencyMs: 120, processedCount: 0, cpuUsage: 35, memoryUsageMb: 450 },
      timestamp: new Date().toISOString(),
      source: 'primary-transcriber',
      correlationId: message.correlationId,
    });
    return;
  }

  if (message.eventType === 'stop_recording') {
    self.postMessage({
      eventType: 'agent_metrics_update',
      payload: { status: 'idle', latencyMs: 0, cpuUsage: 0, memoryUsageMb: 80 },
      timestamp: new Date().toISOString(),
      source: 'primary-transcriber',
      correlationId: message.correlationId,
    });
    return;
  }

  if (message.eventType === 'audio_chunk_ready') {
    const start = performance.now();
    const scenario = SCENARIOS[activeScenario] || SCENARIOS.architecture;

    // Check if we still have segments in this scenario
    if (currentSegmentIndex >= scenario.length) {
      // Loop or stop
      return;
    }

    const currentSeg = scenario[currentSegmentIndex];
    const duration = currentSeg.duration;
    
    // Simulate Whisper processing time: ~150ms per 2s chunk
    setTimeout(() => {
      const latencyMs = performance.now() - start + 120; // adding baseline neural loading lag
      
      const newSegment: TranscriptSegment = {
        id: `seg-${Math.random().toString(36).substring(2, 9)}`,
        timestampStart: timeOffset,
        timestampEnd: timeOffset + duration,
        speaker: 'Unknown', // Diarizer will overlay speaker out-of-band!
        text: {
          raw: currentSeg.text,
        },
        confidence: currentSeg.confidence,
        state: 'raw',
        processingTimeMs: latencyMs,
      };

      timeOffset += duration;
      currentSegmentIndex++;

      // Report metrics
      self.postMessage({
        eventType: 'agent_metrics_update',
        payload: {
          latencyMs: Math.round(latencyMs),
          status: 'running',
          processedCount: currentSegmentIndex,
          cpuUsage: 45,
          memoryUsageMb: 520,
        },
        timestamp: new Date().toISOString(),
        source: 'primary-transcriber',
        correlationId: message.correlationId,
      });

      // Stream raw transcription segment instantly
      self.postMessage({
        eventType: 'raw_segment_ready',
        payload: newSegment,
        timestamp: new Date().toISOString(),
        source: 'primary-transcriber',
        correlationId: message.correlationId,
      });
      
    }, 150); // simulated Whisper chunk process delay
  }
};
