/**
 * The one date helper the views share. An instant from the API reads in the browser's own
 * locale, date and time; nothing at all reads as "Never" (an agent that has not checked in).
 */
export function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : "Never";
}
