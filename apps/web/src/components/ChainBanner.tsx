export const ChainBanner = ({ brokenAt }: { brokenAt: number }) => (
  <div className="banner" role="alert">The event log was changed outside Panorama. First bad entry: {brokenAt}. Treat ticket history after that point as untrusted.</div>
);
