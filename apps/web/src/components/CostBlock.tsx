import { useTicketMetrics } from "../lib/hooks";
import { costText, estimateTitle, formatDuration, formatTokens, hasFigures } from "../lib/metrics";
import { FigureSpans } from "./Figures";
import { SettingsList, SettingsRow } from "./settings/primitives";

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * The ticket panel's Cost block: what the ticket has cost so far, as the server measured and
 * priced it. Time, tokens and the estimate on one line; who has a timer running and since when;
 * then the same figures per model and per actor as two dense lists. A model the price table does
 * not know shows its tokens and "no price", and pulls the total down to "at least" the priced
 * part. A ticket with nothing recorded gets one muted line. Nothing renders until the figures
 * arrive, and nothing when they cannot be loaded: the panel has enough else to say.
 */
export function CostBlock({ ticketId }: { ticketId: string }) {
  const metrics = useTicketMetrics(ticketId);
  if (!metrics.data) return null;
  const m = metrics.data;
  const title = estimateTitle(m.priceDate);
  return (
    <section className="cost-block">
      <h2>Cost</h2>
      {!hasFigures(m) ? (
        <p className="muted">No time or cost recorded</p>
      ) : (
        <>
          <div className="figures">
            <FigureSpans figures={m} priceDate={m.priceDate} />
          </div>
          {m.running.map((r) => (
            <p key={r.actorId} className="running">
              <span className="dot" aria-hidden="true" />
              {`Timer running for ${r.name} since ${when(r.startedAt)}`}
            </p>
          ))}
          {m.byModel.length > 0 && (
            <SettingsList label="Cost by model">
              {m.byModel.map((row) => (
                <SettingsRow
                  key={row.model}
                  identity={<span className="mono">{row.model}</span>}
                  facts={
                    <>
                      <span className="mono muted">{formatTokens(row.tokens.total)} tokens</span>
                      <span className="mono" title={title}>{costText(row)}</span>
                    </>
                  }
                />
              ))}
            </SettingsList>
          )}
          {m.byActor.length > 0 && (
            <SettingsList label="Cost by actor">
              {m.byActor.map((row) => (
                <SettingsRow
                  key={row.actorId}
                  identity={<span className="mono">{row.name}</span>}
                  facts={
                    <>
                      <span className="mono muted">{formatDuration(row.seconds)}</span>
                      <span className="mono muted">{formatTokens(row.tokens.total)} tokens</span>
                      <span className="mono" title={title}>{costText(row)}</span>
                    </>
                  }
                />
              ))}
            </SettingsList>
          )}
        </>
      )}
    </section>
  );
}
