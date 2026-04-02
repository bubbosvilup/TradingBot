// Module responsibility: lightweight event records for UI observability and history buffers.

export interface SystemEvent {
  category?: string;
  id: string;
  time: number;
  scope: string;
  level: string;
  message: string;
  metadata: Record<string, unknown>;
}
