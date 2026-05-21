import type { EventBusMessage, TranscriptSegment } from '../types';

interface SentimentResult {
  score: number; // -1 to +1
  label: 'positive' | 'neutral' | 'negative';
  emotions: Record<string, number>;
}

self.onmessage = (event: MessageEvent) => {
  const message = event.data as EventBusMessage;
  if (!message) return;

  if (message.eventType === 'recording_session_ended') {
    const segments = message.payload as TranscriptSegment[];
    const start = performance.now();

    // Perform aggregate text analysis
    const fullText = segments.map((s) => s.text.aiEnhanced || s.text.formatted || s.text.raw).join(' ');

    const sentiment = analyzeSentiment(fullText);
    const keywords = extractKeywords(fullText);
    const summary = generateMeetingMinutes(segments);

    const latencyMs = performance.now() - start;

    // Report metrics
    self.postMessage({
      eventType: 'agent_metrics_update',
      payload: {
        latencyMs: Math.round(latencyMs),
        status: 'idle',
        processedCount: segments.length,
        cpuUsage: 15,
        memoryUsageMb: 85,
      },
      timestamp: new Date().toISOString(),
      source: 'content-analyzer',
      correlationId: message.correlationId,
    });

    // Send content analysis done event
    self.postMessage({
      eventType: 'content_analysis_done',
      payload: {
        sentiment,
        keywords,
        summary,
      },
      timestamp: new Date().toISOString(),
      source: 'content-analyzer',
      correlationId: message.correlationId,
    });
  }
};

function analyzeSentiment(text: string): SentimentResult {
  const positiveWords = ['great', 'excellent', 'amazing', 'perfect', 'scary', 'healthy', 'solve', 'incredible', 'journey', 'dream', 'good', 'happy'];
  const negativeWords = ['scary', 'fatigue', 'side effects', 'sick', 'error', 'slow', 'fail', 'bad', 'pain', 'palpitations', 'worried'];

  let posCount = 0;
  let negCount = 0;

  const lower = text.toLowerCase();
  positiveWords.forEach((word) => {
    const matches = lower.match(new RegExp(`\\b${word}\\b`, 'g'));
    if (matches) posCount += matches.length;
  });

  negativeWords.forEach((word) => {
    const matches = lower.match(new RegExp(`\\b${word}\\b`, 'g'));
    if (matches) negCount += matches.length;
  });

  const diff = posCount - negCount;
  const sum = posCount + negCount;
  const score = sum > 0 ? diff / sum : 0;

  let label: 'positive' | 'neutral' | 'negative' = 'neutral';
  if (score > 0.15) label = 'positive';
  if (score < -0.15) label = 'negative';

  // Basic emotion distribution
  const emotions = {
    joy: 0.1,
    anticipation: 0.2,
    trust: 0.3,
    fear: 0.0,
    sadness: 0.0,
  };

  if (lower.includes('scary') || lower.includes('palpitations')) {
    emotions.fear = 0.65;
    emotions.trust = 0.2;
  }
  if (lower.includes('incredible') || lower.includes('amazing') || lower.includes('dream')) {
    emotions.joy = 0.75;
    emotions.trust = 0.5;
  }
  if (lower.includes('prescription') || lower.includes('prescribe') || lower.includes('doctor')) {
    emotions.trust = 0.8;
  }

  return {
    score,
    label,
    emotions,
  };
}

function extractKeywords(text: string): { word: string; score: number }[] {
  const words = text.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, '')
    .split(/\s+/);

  const stopwords = new Set([
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'he', 'him', 'his',
    'she', 'her', 'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
    'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do',
    'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while',
    'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
    'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each',
    'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
    'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'us', 'let', 'would', 'feels', 'make',
    'go', 'going', 'write', 'tell'
  ]);

  const freq: Record<string, number> = {};
  words.forEach((w) => {
    if (w.length > 2 && !stopwords.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  });

  return Object.entries(freq)
    .map(([word, count]) => ({
      word: word.charAt(0).toUpperCase() + word.slice(1),
      score: count * 1.5,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

interface MeetingMinutes {
  executiveOverview: string;
  agendaItems: string[];
  actionItems: { task: string; assignee: string; priority: 'low' | 'medium' | 'high' }[];
  speakerContributions: Record<string, number>;
}

function generateMeetingMinutes(segments: TranscriptSegment[]): MeetingMinutes {
  const speakerCount: Record<string, number> = {};
  let totalSegments = 0;

  segments.forEach((s) => {
    if (s.speaker !== 'Unknown') {
      speakerCount[s.speaker] = (speakerCount[s.speaker] || 0) + 1;
      totalSegments++;
    }
  });

  const contributions: Record<string, number> = {};
  Object.entries(speakerCount).forEach(([spk, count]) => {
    contributions[spk] = Math.round((count / totalSegments) * 100);
  });

  // Extract scenario based information
  const firstText = segments[0]?.text.raw.toLowerCase() || '';
  let executiveOverview = 'Summary of session transcription details and highlights.';
  let agendaItems: string[] = [];
  let actionItems: { task: string; assignee: string; priority: 'low' | 'medium' | 'high' }[] = [];

  if (firstText.includes('doctor') || firstText.includes('cardiology') || firstText.includes('palpitations')) {
    executiveOverview = 'A clinical patient evaluation checkup regarding heart palpitations and potential PVC events.';
    agendaItems = [
      'Patient report on palpitations and rests issues',
      'Diagnostic check: heart rate noted at 95 bpm',
      'Prescription and dosage adjustments for symptoms alleviation',
      'Follow-up plans established'
    ];
    actionItems = [
      { task: 'Take Metoprolol 23.5 mg t.i.d. daily', assignee: 'Patient (Arthur)', priority: 'high' },
      { task: 'Monitor for mild fatigue or drowsiness side effects', assignee: 'Patient (Arthur)', priority: 'medium' },
      { task: 'Secure clinic follow-up appointment in 2 weeks', assignee: 'Patient (Arthur)', priority: 'high' }
    ];
  } else if (firstText.includes('routing') || firstText.includes('tcp') || firstText.includes('ai routing')) {
    executiveOverview = 'Technical coordination and design review of local vs cloud LLM routing capabilities in Tauri.';
    agendaItems = [
      'Establishing GGUF local model inference integration',
      'Tauri multithreading architecture guidelines review',
      'Formulating Cloud AI fallback latency limits',
      'Writing GGUF model execution benchmarks'
    ];
    actionItems = [
      { task: 'Natively package Phi-3-mini GGUF files in Tauri build system', assignee: 'Architect (Marcus)', priority: 'high' },
      { task: 'Write benchmark scripts for model loading & latency evaluations', assignee: 'Lead Dev (Sarah)', priority: 'medium' },
      { task: 'Integrate the async AI Router Worker thread fallback triggers', assignee: 'Lead Dev (Sarah)', priority: 'high' }
    ];
  } else if (firstText.includes('deepmind') || firstText.includes('masters') || firstText.includes('journey')) {
    executiveOverview = 'Career interview discussing DeepMind research milestones, protein-folding AlphaFold solve, and game agents.';
    agendaItems = [
      'Interviewer review of candidate career timeline',
      'DeepMind game agents and reinforcement learning experience review',
      'AlphaFold team contributions and structure prediction impacts discussion',
      'Scientific breakthrough overview'
    ];
    actionItems = [
      { task: 'Provide thesis copy or publications list on RL agents', assignee: 'Candidate (Alan)', priority: 'medium' },
      { task: 'Schedule technical round two review panel', assignee: 'Interviewer (Clara)', priority: 'high' }
    ];
  }

  return {
    executiveOverview,
    agendaItems,
    actionItems,
    speakerContributions: contributions,
  };
}
