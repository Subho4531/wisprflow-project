import type { EventBusMessage, TranscriptSegment, UserPreferences } from '../types';

let preferences: UserPreferences = {
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

// Listen for messages in the worker thread
self.onmessage = (event: MessageEvent) => {
  const message = event.data as EventBusMessage;
  if (!message) return;

  if (message.eventType === 'preferences_updated') {
    preferences = { ...preferences, ...message.payload };
    return;
  }

  if (message.eventType === 'raw_segment_ready') {
    const segment = message.payload as TranscriptSegment;
    const start = performance.now();

    // Perform text processing
    const processedText = processText(segment.text.raw);
    const latencyMs = performance.now() - start;

    // Report metrics to Main Thread Event Bus
    self.postMessage({
      eventType: 'agent_metrics_update',
      payload: {
        latencyMs: Math.round(latencyMs * 10) / 10,
        status: 'idle',
        processedCount: 1,
        cpuUsage: 12, // Estimated CPU usage for this short task
        memoryUsageMb: 8.5,
      },
      timestamp: new Date().toISOString(),
      source: 'text-processor',
      correlationId: message.correlationId,
    });

    // Publish formatting completion
    const updatedSegment: TranscriptSegment = {
      ...segment,
      text: {
        ...segment.text,
        formatted: processedText,
      },
      state: 'formatted',
      processingTimeMs: (segment.processingTimeMs || 0) + latencyMs,
    };

    self.postMessage({
      eventType: 'format_completed',
      payload: updatedSegment,
      timestamp: new Date().toISOString(),
      source: 'text-processor',
      correlationId: message.correlationId,
    });
  }
};

function processText(text: string): string {
  let cleaned = text;

  // 1. Whitespace Normalization
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // 2. Filler Word Removal
  if (preferences.fillerWordRemoval) {
    preferences.fillerWords.forEach((word) => {
      // Handle word boundary and case insensitivity
      const regex = new RegExp(`\\b${word}\\b,?\\s*`, 'gi');
      cleaned = cleaned.replace(regex, '');
    });
    // Double spaces cleaning
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
  }

  // 3. Acronym Replacement
  if (preferences.acronyms) {
    Object.entries(preferences.acronyms).forEach(([spoken, replaced]) => {
      const regex = new RegExp(`\\b${spoken}\\b`, 'gi');
      cleaned = cleaned.replace(regex, replaced);
    });
  }

  // 4. Proper Nouns Capitalization
  if (preferences.capitalization && preferences.properNouns) {
    preferences.properNouns.forEach((noun) => {
      const regex = new RegExp(`\\b${noun}\\b`, 'gi');
      cleaned = cleaned.replace(regex, noun);
    });
  }

  // 5. Punctuation restoration
  if (preferences.punctuationInsertion) {
    // Basic heuristics: if the segment has no punctuation, add a period at the end
    if (!/[.!?]$/.test(cleaned) && cleaned.length > 0) {
      // If it ends with conversational questions
      if (/^(how|what|why|who|where|when|can|is|are|do|does|will|should)\b/i.test(cleaned)) {
        cleaned += '?';
      } else {
        cleaned += '.';
      }
    }

    // Restore common mid-sentence pause indicators (commas)
    // Add comma before coordinate conjunctions in long sentences
    const clauses = cleaned.split(/\s(but|and|or|although|because|since)\s/i);
    if (clauses.length > 1 && cleaned.length > 40) {
      cleaned = cleaned.replace(/\s(but|although|because|since)\s/gi, ', $1 ');
    }
  }

  // 6. Sentence Boundary Capitalization
  if (preferences.capitalization) {
    // Capitalize first character of string
    cleaned = cleaned.replace(/^[a-z]/, (char) => char.toUpperCase());

    // Capitalize first letter after . ! ?
    cleaned = cleaned.replace(/([.!?]\s+)([a-z])/g, (_, boundary, char) => boundary + char.toUpperCase());

    // Always capitalize individual 'i'
    cleaned = cleaned.replace(/\bi\b/g, 'I');
  }

  // 7. Number Formatting
  if (preferences.numberFormatting) {
    const numberMap: Record<string, string> = {
      one: '1', two: '2', three: '3', four: '4', five: '5',
      six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
      eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
      sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
      thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90',
      hundred: '100', thousand: '1000'
    };

    // Replace spoken numbers
    Object.entries(numberMap).forEach(([word, num]) => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      cleaned = cleaned.replace(regex, num);
    });

    // Compound numbers: "twenty 3" -> "23"
    cleaned = cleaned.replace(/\b(20|30|40|50|60|70|80|90)\s([1-9])\b/g, (_, dec, unit) => {
      const decVal = parseInt(dec);
      const unitVal = parseInt(unit);
      return (decVal + unitVal).toString();
    });
  }

  return cleaned;
}
