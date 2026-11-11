import { ArrowDownRight, Check, CircleDot, OctagonX, RotateCw, ShieldCheck } from 'lucide-react';
import type { TraceEvent } from '../domain/types';
const iconFor = (type: string) =>
  type === 'node.retry'
    ? RotateCw
    : type === 'node.failed' || type === 'node.blocked'
      ? OctagonX
      : type === 'node.cached'
        ? ShieldCheck
        : type === 'node.succeeded'
          ? Check
          : CircleDot;
export function EventLog({
  events,
  cursor,
  selected,
  onSeek,
}: {
  events: TraceEvent[];
  cursor: number;
  selected: string | null;
  onSeek: (count: number) => void;
}) {
  const shown = selected ? events.filter((e) => e.nodeId === selected) : events;
  return (
    <div className="event-log" aria-label="Simulation event log">
      <div className="log-head">
        <span>TIME</span>
        <span>EVENT / NODE</span>
        <span>DETAIL</span>
      </div>
      {shown.length === 0 ? (
        <div className="empty-state">
          <ArrowDownRight size={22} />
          <p>Run a simulation to record its decisions.</p>
          <span>Every start, failure, retry, and cache hit will appear here.</span>
        </div>
      ) : (
        shown.map((event) => {
          const Icon = iconFor(event.type);
          const future = event.sequence > cursor;
          return (
            <button
              className={`event-row ${future ? 'future' : ''} ${event.sequence === cursor ? 'current' : ''}`}
              key={event.sequence}
              onClick={() => onSeek(event.sequence)}
              aria-label={`Replay to event ${event.sequence}: ${event.type} at ${event.at} milliseconds`}
            >
              <span className="event-time">
                +{event.at.toLocaleString()}
                <small>ms</small>
              </span>
              <span className={`event-kind ${event.type.split('.')[1]}`}>
                <Icon size={13} />
                <span>
                  <b>{event.type.replace('node.', '').replace('run.', 'run ')}</b>
                  <small>{event.nodeId ?? 'scheduler'}</small>
                </span>
              </span>
              <span className="event-message">{event.message}</span>
            </button>
          );
        })
      )}
    </div>
  );
}
