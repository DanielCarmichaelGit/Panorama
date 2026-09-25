/** The bits of a react-query result `tabState` needs: enough to show a skeleton or a retry, nothing tab-specific. */
interface QueryState {
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

/**
 * A plain helper, not a component: called during a tab's render for the shared loading skeleton and error-with-retry chrome for a Settings tab backed by one query.
 * Renders the skeleton while pending, an error with a Try again button on failure, or null once
 * the query has data so the tab can render its real content. `label` names what failed to load
 * ("fields", "tags", "evidence types"), for "Could not load {label}.".
 */
export function tabState({ query, label, rows = 3 }: { query: QueryState; label: string; rows?: number }): JSX.Element | null {
  if (query.isPending) {
    return <div className="settings-list">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}</div>;
  }
  if (query.isError) {
    return (
      <div>
        <p className="error" role="alert">Could not load {label}.</p>
        <button type="button" className="btn" onClick={() => query.refetch()}>Try again</button>
      </div>
    );
  }
  return null;
}
