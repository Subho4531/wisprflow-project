import type { EventBusMessage, AgentType, AgentMetrics, AgentStatus } from './types';

type EventCallback = (message: EventBusMessage) => void;

class EventBus {
  private subscribers: Map<string, Set<EventCallback>> = new Map();
  private workers: Map<AgentType, Worker> = new Map();
  private logs: EventBusMessage[] = [];
  private maxLogs = 50;

  private agentMetrics: Record<AgentType, AgentMetrics> = {
    'audio-processor': { name: 'audio-processor', displayName: 'Audio Processor', status: 'idle', latencyMs: 0, processedCount: 0, cpuUsage: 0, memoryUsageMb: 0 },
    'primary-transcriber': { name: 'primary-transcriber', displayName: 'Primary Transcriber', status: 'idle', latencyMs: 0, processedCount: 0, cpuUsage: 0, memoryUsageMb: 0 },
    'secondary-verifier': { name: 'secondary-verifier', displayName: 'Secondary Verifier', status: 'idle', latencyMs: 0, processedCount: 0, cpuUsage: 0, memoryUsageMb: 0 },
    'text-processor': { name: 'text-processor', displayName: 'Text Formatter (Rule)', status: 'idle', latencyMs: 0, processedCount: 0, cpuUsage: 0, memoryUsageMb: 0 },
    'ai-router': { name: 'ai-router', displayName: 'AI Processing Router', status: 'idle', latencyMs: 0, processedCount: 0, cpuUsage: 0, memoryUsageMb: 0 },
    'speaker-diarizer': { name: 'speaker-diarizer', displayName: 'Speaker Diarizer', status: 'idle', latencyMs: 0, processedCount: 0, cpuUsage: 0, memoryUsageMb: 0 },
    'content-analyzer': { name: 'content-analyzer', displayName: 'Content Analyst', status: 'idle', latencyMs: 0, processedCount: 0, cpuUsage: 0, memoryUsageMb: 0 },
    'export-formatter': { name: 'export-formatter', displayName: 'Export Formatter', status: 'idle', latencyMs: 0, processedCount: 0, cpuUsage: 0, memoryUsageMb: 0 },
  };

  private static instance: EventBus;

  private constructor() {}

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * Subscribe to a specific event type on the event bus.
   */
  public subscribe(eventType: string, callback: EventCallback): () => void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(callback);

    // Return an unsubscribe function
    return () => {
      const subs = this.subscribers.get(eventType);
      if (subs) {
        subs.delete(callback);
      }
    };
  }

  /**
   * Publish an event to all subscribers and optionally forward it to register workers.
   */
  public publish<T = any>(
    eventType: string,
    payload: T,
    source: string,
    correlationId = Math.random().toString(36).substring(2, 11)
  ): void {
    const message: EventBusMessage<T> = {
      eventType,
      payload,
      timestamp: new Date().toISOString(),
      source,
      correlationId,
    };

    // Log the message
    this.logs.unshift(message);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    // Trigger local subscribers
    const subs = this.subscribers.get(eventType);
    if (subs) {
      subs.forEach((cb) => {
        try {
          cb(message);
        } catch (e) {
          console.error(`Error in event bus subscriber for "${eventType}":`, e);
        }
      });
    }

    // Broadcast also triggers a global message listener for logging
    const globalSubs = this.subscribers.get('*');
    if (globalSubs) {
      globalSubs.forEach((cb) => cb(message));
    }

    // Distribute to workers that listen to this event type
    this.workers.forEach((worker, workerType) => {
      // Don't echo back to the source worker
      if (source !== workerType) {
        worker.postMessage(message);
      }
    });
  }

  /**
   * Register a Web Worker as an agent, automatically wiring its inbound and outbound messages.
   */
  public registerWorker(agentType: AgentType, worker: Worker): void {
    this.workers.set(agentType, worker);
    this.updateAgentStatus(agentType, 'idle');

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as EventBusMessage;
      if (message && message.eventType) {
        // Intercept worker performance telemetry
        if (message.eventType === 'agent_metrics_update') {
          this.updateAgentMetrics(agentType, message.payload);
        } else {
          // Re-publish the worker's output event onto the main event bus
          this.publish(
            message.eventType,
            message.payload,
            agentType,
            message.correlationId
          );
        }
      }
    };

    worker.onerror = (error) => {
      console.error(`Error in worker [${agentType}]:`, error);
      this.updateAgentStatus(agentType, 'error');
    };
  }

  /**
   * Terminate all registered workers and reset state.
   */
  public shutdown(): void {
    this.workers.forEach((worker, type) => {
      worker.terminate();
      this.updateAgentStatus(type, 'idle');
    });
    this.workers.clear();
    this.logs = [];
  }

  public updateAgentStatus(agentType: AgentType, status: AgentStatus): void {
    this.agentMetrics[agentType].status = status;
    this.publishTelemetryUpdate();
  }

  public updateAgentMetrics(agentType: AgentType, metrics: Partial<AgentMetrics>): void {
    this.agentMetrics[agentType] = {
      ...this.agentMetrics[agentType],
      ...metrics,
    };
    this.publishTelemetryUpdate();
  }

  public getAgentMetrics(): Record<AgentType, AgentMetrics> {
    return this.agentMetrics;
  }

  public getLogs(): EventBusMessage[] {
    return this.logs;
  }

  private publishTelemetryUpdate(): void {
    // Collect global stats
    let activeAgents = 0;
    let totalLatency = 0;
    let avgCpu = 0;
    let avgMem = 0;

    const metricsList = Object.values(this.agentMetrics);
    metricsList.forEach((m) => {
      if (m.status === 'running' || m.status === 'loading') {
        activeAgents++;
      }
      totalLatency += m.latencyMs;
      avgCpu += m.cpuUsage;
      avgMem += m.memoryUsageMb;
    });

    const telemetry = {
      cpuUsage: Math.min(Math.round(avgCpu), 100),
      memoryUsageMb: Math.round(avgMem * 10) / 10,
      activeAgents,
      latencyMs: activeAgents > 0 ? Math.round(totalLatency / activeAgents) : 0,
    };

    // Trigger local listeners for UI render without bloating message queues
    const subs = this.subscribers.get('telemetry_updated');
    if (subs) {
      const msg: EventBusMessage = {
        eventType: 'telemetry_updated',
        payload: telemetry,
        timestamp: new Date().toISOString(),
        source: 'event-bus',
        correlationId: 'telemetry',
      };
      subs.forEach((cb) => cb(msg));
    }
  }
}

export const eventBus = EventBus.getInstance();
