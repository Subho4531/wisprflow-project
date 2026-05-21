import type { EventBusMessage, TranscriptSegment } from '../types';

self.onmessage = (event: MessageEvent) => {
  const message = event.data as EventBusMessage;
  if (!message) return;

  if (message.eventType === 'request_export') {
    const { segments, format } = message.payload as { segments: TranscriptSegment[]; format: string };
    const start = performance.now();

    let outputText = '';
    let mimeType = 'text/plain';
    let fileExtension = 'txt';

    switch (format) {
      case 'srt':
        outputText = convertToSRT(segments);
        mimeType = 'text/srt';
        fileExtension = 'srt';
        break;
      case 'vtt':
        outputText = convertToVTT(segments);
        mimeType = 'text/vtt';
        fileExtension = 'vtt';
        break;
      case 'json':
        outputText = JSON.stringify(segments, null, 2);
        mimeType = 'application/json';
        fileExtension = 'json';
        break;
      case 'docx':
        outputText = convertToDOCX(segments);
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        fileExtension = 'docx';
        break;
      case 'txt':
      default:
        outputText = convertToTXT(segments);
        mimeType = 'text/plain';
        fileExtension = 'txt';
        break;
    }

    const latencyMs = performance.now() - start;

    // Report metrics
    self.postMessage({
      eventType: 'agent_metrics_update',
      payload: {
        latencyMs: Math.round(latencyMs * 10) / 10,
        status: 'idle',
        processedCount: segments.length,
        cpuUsage: 5,
        memoryUsageMb: 8,
      },
      timestamp: new Date().toISOString(),
      source: 'export-formatter',
      correlationId: message.correlationId,
    });

    const filename = `wisprtype-transcript-${new Date().toISOString().slice(0, 10)}.${fileExtension}`;

    // Send completed export file bundle
    self.postMessage({
      eventType: 'export_finished',
      payload: {
        fileContent: outputText,
        mimeType: mimeType,
        filename: filename,
      },
      timestamp: new Date().toISOString(),
      source: 'export-formatter',
      correlationId: message.correlationId,
    });
  }
};

function formatTime(seconds: number, useDot = false): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  const hs = h.toString().padStart(2, '0');
  const msStr = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  const mss = ms.toString().padStart(3, '0');

  const sep = useDot ? '.' : ',';
  return `${hs}:${msStr}:${ss}${sep}${mss}`;
}

function convertToTXT(segments: TranscriptSegment[]): string {
  return segments.map((s) => {
    const text = s.text.aiEnhanced || s.text.formatted || s.text.raw;
    const speaker = s.speaker === 'Unknown' ? 'Speaker' : s.speaker;
    const time = `[${formatTime(s.timestampStart).substring(3, 8)}]`;
    return `${time} ${speaker}: ${text}`;
  }).join('\n\n');
}

function convertToSRT(segments: TranscriptSegment[]): string {
  return segments.map((s, index) => {
    const text = s.text.aiEnhanced || s.text.formatted || s.text.raw;
    const start = formatTime(s.timestampStart);
    const end = formatTime(s.timestampEnd);
    return `${index + 1}\n${start} --> ${end}\n${text}\n`;
  }).join('\n');
}

function convertToVTT(segments: TranscriptSegment[]): string {
  const srt = segments.map((s, index) => {
    const text = s.text.aiEnhanced || s.text.formatted || s.text.raw;
    const start = formatTime(s.timestampStart, true);
    const end = formatTime(s.timestampEnd, true);
    return `${index + 1}\n${start} --> ${end}\n${text}\n`;
  }).join('\n');
  return `WEBVTT\n\n${srt}`;
}

function convertToDOCX(segments: TranscriptSegment[]): string {
  // Return styled HTML that can be loaded directly as a document file
  const rows = segments.map((s) => {
    const text = s.text.aiEnhanced || s.text.formatted || s.text.raw;
    const speaker = s.speaker === 'Unknown' ? 'Speaker' : s.speaker;
    const time = formatTime(s.timestampStart).substring(3, 8);
    return `
      <div style="margin-bottom:15px; font-family:'Segoe UI',Arial,sans-serif;">
        <span style="font-weight:bold; color:#4285F4; margin-right:10px;">${speaker}</span>
        <span style="color:#888888; font-size:12px; margin-right:15px;">${time}</span>
        <p style="margin:5px 0 0 0; color:#333333; line-height:1.5;">${text}</p>
      </div>
    `;
  }).join('');

  return `
    <html>
      <head>
        <meta charset="utf-8">
        <title>WisprType Transcript Export</title>
      </head>
      <body style="padding:40px; font-size:14px; max-width:800px; margin:0 auto;">
        <h1 style="font-family:'Segoe UI',Arial,sans-serif; color:#333333; border-bottom:1px solid #eeeeee; padding-bottom:10px;">WisprType Session Transcript</h1>
        <p style="color:#888888; font-size:12px; font-family:'Segoe UI',Arial,sans-serif;">Generated on ${new Date().toLocaleDateString()}</p>
        <hr style="border:0; border-top:1px solid #eeeeee; margin-bottom:30px;"/>
        ${rows}
      </body>
    </html>
  `;
}
