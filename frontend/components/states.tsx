export type DisplayState = 'candidate' | 'stale' | 'unavailable' | 'explicit' | 'inferred'

export const StatePanel = ({ state, message }: Readonly<{ state: DisplayState; message: string }>) => <section
  className="state-panel"
  data-state={state}
  role="status"
  aria-label={`${state}: ${message}`}
>{message}</section>
